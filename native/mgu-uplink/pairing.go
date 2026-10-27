package main

// iPhone pairing. An iPhone serves its Personal Hotspot over USB only to a
// host it trusts, and it trusts a host for a connection of the cable once
// that host opens a lockdown session as a host it paired with. The uplink
// does what usbmuxd does for a computer on each connection:
//
//	StartSession {HostID, SystemBUID}, then TLS with the host certificate
//	    the phone knows this unit: done
//	InvalidHostID: the phone does not know this unit (never paired, or it
//	    forgot), so pair:
//	GetValue DevicePublicKey; a device certificate for that key, signed by
//	    this unit's root certificate
//	SetValue UntrustedHostBUID; Pair {PairRecord}
//	    PairingDialogResponsePending: the phone shows "Trust This Computer?"
//	    and, once its owner taps Trust and enters the passcode, posts
//	    com.apple.mobile.lockdown.request_pair through its notification
//	    proxy; Pair again then succeeds
//	StartSession as above
//
// The unit's host identity (root and host keys and certificates, HostID,
// SystemBUID) is made once and kept in pairing/host.json under the state
// folder, which updates keep, so the phone asks for Trust once and
// recognises the unit on every later connection. The certificates follow
// libimobiledevice's (userpref.c): RSA 2048, SHA-256, empty names, ten
// years, a CA root and two end certificates for digital signature and key
// encipherment.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	lockdownType      = "com.apple.mobile.lockdown"
	notifyProxy       = "com.apple.mobile.insecure_notification_proxy"
	notifyRequestPair = "com.apple.mobile.lockdown.request_pair"
	notifyHostBUID    = "com.apple.mobile.lockdown.request_host_buid"

	// pairRetry: without a notification from the phone, Pair is asked again
	// after this long.
	pairRetry = 60 * time.Second

	trustTapNote    = "Tap Trust on the iPhone and enter its passcode"
	trustUnlockNote = "Unlock the iPhone"
)

// hostIdentity is this unit as a paired host. The PEM fields are what
// lockdown's pair record carries.
type hostIdentity struct {
	HostID          string `json:"hostID"`
	SystemBUID      string `json:"systemBUID"`
	RootCertificate string `json:"rootCertificate"`
	RootPrivateKey  string `json:"rootPrivateKey"`
	HostCertificate string `json:"hostCertificate"`
	HostPrivateKey  string `json:"hostPrivateKey"`
}

func hostIdentityFile(dir string) string { return filepath.Join(dir, "host.json") }

// loadHostIdentity reads the unit's host identity from dir, making and
// saving one when there is none.
func loadHostIdentity(dir string) (*hostIdentity, error) {
	var id hostIdentity
	if b, err := os.ReadFile(hostIdentityFile(dir)); err == nil {
		if json.Unmarshal(b, &id) == nil && id.valid() {
			return &id, nil
		}
		logf("pairing: %s is unreadable, making a new host identity", hostIdentityFile(dir))
	}
	nid, err := newHostIdentity()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	if err := writeJSON(hostIdentityFile(dir), nid, 0600); err != nil {
		return nil, err
	}
	return nid, nil
}

func (id *hostIdentity) valid() bool {
	if id.HostID == "" || id.SystemBUID == "" {
		return false
	}
	_, _, err := id.root()
	return err == nil
}

func newHostIdentity() (*hostIdentity, error) {
	rootKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	hostKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	rootTmpl := certTemplate()
	rootTmpl.IsCA = true
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTmpl, rootTmpl, &rootKey.PublicKey, rootKey)
	if err != nil {
		return nil, err
	}
	root, err := x509.ParseCertificate(rootDER)
	if err != nil {
		return nil, err
	}
	hostDER, err := x509.CreateCertificate(rand.Reader, endTemplate(&hostKey.PublicKey), root, &hostKey.PublicKey, rootKey)
	if err != nil {
		return nil, err
	}
	return &hostIdentity{
		HostID:          newUUID(),
		SystemBUID:      newUUID(),
		RootCertificate: pemString("CERTIFICATE", rootDER),
		RootPrivateKey:  pemString("RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(rootKey)),
		HostCertificate: pemString("CERTIFICATE", hostDER),
		HostPrivateKey:  pemString("RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(hostKey)),
	}, nil
}

func certTemplate() *x509.Certificate {
	now := time.Now()
	return &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.AddDate(10, 0, 0),
		BasicConstraintsValid: true,
	}
}

// endTemplate is a host or device certificate for pub.
func endTemplate(pub *rsa.PublicKey) *x509.Certificate {
	t := certTemplate()
	t.KeyUsage = x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment
	ski := sha1.Sum(x509.MarshalPKCS1PublicKey(pub))
	t.SubjectKeyId = ski[:]
	return t
}

func (id *hostIdentity) root() (*x509.Certificate, *rsa.PrivateKey, error) {
	cb, _ := pem.Decode([]byte(id.RootCertificate))
	kb, _ := pem.Decode([]byte(id.RootPrivateKey))
	if cb == nil || kb == nil {
		return nil, nil, errors.New("pairing: root certificate or key missing")
	}
	cert, err := x509.ParseCertificate(cb.Bytes)
	if err != nil {
		return nil, nil, err
	}
	key, err := x509.ParsePKCS1PrivateKey(kb.Bytes)
	if err != nil {
		return nil, nil, err
	}
	return cert, key, nil
}

// deviceCertificate signs the phone's public key (lockdown's
// DevicePublicKey: a PEM PKCS#1 RSA key) with the unit's root, as PEM.
func (id *hostIdentity) deviceCertificate(devicePublicKey []byte) ([]byte, error) {
	b, _ := pem.Decode(devicePublicKey)
	if b == nil {
		return nil, errors.New("pairing: the phone's public key is not PEM")
	}
	pub, err := x509.ParsePKCS1PublicKey(b.Bytes)
	if err != nil {
		if k, err2 := x509.ParsePKIXPublicKey(b.Bytes); err2 == nil {
			if rk, ok := k.(*rsa.PublicKey); ok {
				pub, err = rk, nil
			}
		}
		if err != nil {
			return nil, fmt.Errorf("pairing: the phone's public key: %v", err)
		}
	}
	root, rootKey, err := id.root()
	if err != nil {
		return nil, err
	}
	der, err := x509.CreateCertificate(rand.Reader, endTemplate(pub), root, pub, rootKey)
	if err != nil {
		return nil, err
	}
	return []byte(pemString("CERTIFICATE", der)), nil
}

func pemString(typ string, der []byte) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}))
}

// newUUID is a random (version 4) UUID in upper case, as lockdown's HostID
// and SystemBUID are.
func newUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return strings.ToUpper(fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]))
}

// iphoneTrust makes the phone trust the unit for this connection: a
// lockdown session as the paired host, pairing first when the phone does
// not know the unit. note tells the phone's owner what to do ("" when
// nothing).
func iphoneTrust(ctx context.Context, m *usbMux, dir string, note func(string)) error {
	id, err := loadHostIdentity(dir)
	if err != nil {
		return fmt.Errorf("pairing: host identity: %w", err)
	}
	err = iphoneSession(m, id)
	if err == nil {
		return nil
	}
	if !isLockdownError(err, "InvalidHostID") && !strings.Contains(err.Error(), "TLS") {
		return err
	}
	logf("iPhone: not paired with this unit (%v); pairing", err)
	if err := iphonePair(ctx, m, id, note); err != nil {
		return err
	}
	logf("iPhone: paired")
	note("")
	return iphoneSession(m, id)
}

func iphoneSession(m *usbMux, id *hostIdentity) error {
	l, err := dialLockdown(m)
	if err != nil {
		return err
	}
	defer l.Close()
	if t, err := l.queryType(); err != nil {
		return err
	} else if t != lockdownType {
		return fmt.Errorf("lockdown type %q", t)
	}
	return l.startSession(id)
}

// iphonePair pairs the phone with the unit, waiting for its owner to tap
// Trust and enter the passcode.
func iphonePair(ctx context.Context, m *usbMux, id *hostIdentity, note func(string)) error {
	l, err := dialLockdown(m)
	if err != nil {
		return err
	}
	pub, err := l.getValue("DevicePublicKey")
	if err != nil {
		l.Close()
		return err
	}
	pubPEM, ok := pub.([]byte)
	if !ok {
		l.Close()
		return errors.New("pairing: no DevicePublicKey")
	}
	devCert, err := id.deviceCertificate(pubPEM)
	if err != nil {
		l.Close()
		return err
	}
	l.setValue(lockdownType, "UntrustedHostBUID", id.SystemBUID)
	_, err = l.pair(id, devCert)
	if err == nil {
		l.Close()
		return nil
	}
	events, stopWatch := watchPairRequests(m, l)
	defer stopWatch()
	l.Close()
	for {
		switch {
		case isLockdownError(err, "PairingDialogResponsePending"), isLockdownError(err, "UserDeniedPairing"):
			note(trustTapNote)
		case isLockdownError(err, "PasswordProtected"):
			note(trustUnlockNote)
		default:
			return err
		}
		logf("iPhone: waiting for Trust (%v)", err)
		retry := time.NewTimer(pairRetry)
		select {
		case <-ctx.Done():
			retry.Stop()
			return ctx.Err()
		case ev, ok := <-events:
			if !ok {
				events = nil // the proxy went away: Pair is asked again on the timer
			} else if ev == notifyHostBUID {
				if l, err := dialLockdown(m); err == nil {
					l.setValue(lockdownType, "UntrustedHostBUID", id.SystemBUID)
					l.Close()
				}
				retry.Stop()
				continue
			}
		case <-retry.C:
		}
		retry.Stop()
		l, err2 := dialLockdown(m)
		if err2 != nil {
			return err2
		}
		_, err = l.pair(id, devCert)
		l.Close()
		if err == nil {
			return nil
		}
	}
}

// watchPairRequests subscribes to the phone's notification proxy for the
// two notifications pairing waits on and returns them as they arrive. When
// the proxy cannot be reached the channel is nil: Pair is then retried on
// a timer.
func watchPairRequests(m *usbMux, l *lockdownClient) (<-chan string, func()) {
	port, err := l.startService(notifyProxy)
	if err != nil {
		logf("iPhone: notification proxy: %v", err)
		return nil, func() {}
	}
	c, err := m.Dial(port)
	if err != nil {
		logf("iPhone: notification proxy: %v", err)
		return nil, func() {}
	}
	for _, name := range []string{notifyRequestPair, notifyHostBUID} {
		if err := plistSend(c, map[string]any{"Command": "ObserveNotification", "Name": name}); err != nil {
			c.Close()
			return nil, func() {}
		}
	}
	ch := make(chan string, 4)
	go func() {
		defer close(ch)
		for {
			doc, err := plistRecvRaw(c)
			if err != nil {
				return
			}
			// Matched on the raw message, so either plist form works.
			for _, name := range []string{notifyHostBUID, notifyRequestPair} {
				if bytes.Contains(doc, []byte(name)) {
					select {
					case ch <- name:
					default: // one waiting is enough
					}
					break
				}
			}
		}
	}()
	return ch, func() { c.Close() }
}
