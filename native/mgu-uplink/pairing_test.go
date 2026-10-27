package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"os"
	"reflect"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestPlistRoundTrip(t *testing.T) {
	in := map[string]any{
		"Request": "Pair", "ProtocolVersion": "2", "Flag": true, "Off": false, "Port": int64(62078),
		"Data": []byte{0, 1, 2, 0xff}, "Esc": "a<b>&c",
		"PairRecord": map[string]any{"HostID": "ABC"}, "List": []any{"x", int64(1)},
	}
	doc, err := plistEncode(in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := plistDecode(doc)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(in, out) {
		t.Fatalf("round trip:\n%v\n%v", in, out)
	}
	// What lockdown sends: the whitespace and line breaks of a pretty plist.
	v, err := plistDecode([]byte("<?xml version=\"1.0\"?>\n<plist version=\"1.0\">\n<dict>\n\t<key>Value</key>\n\t<data>\n\tAAEC\n\t/w==\n\t</data>\n</dict>\n</plist>\n"))
	if err != nil || !bytes.Equal(v.(map[string]any)["Value"].([]byte), []byte{0, 1, 2, 0xff}) {
		t.Fatalf("pretty data: %v %v", v, err)
	}
	if _, err := plistDecode([]byte("bplist00")); err == nil {
		t.Fatal("binary plist accepted")
	}
}

func TestHostIdentity(t *testing.T) {
	dir := t.TempDir()
	id, err := loadHostIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(hostIdentityFile(dir)); err != nil || fi.Mode().Perm() != 0600 {
		t.Fatalf("host.json: %v %v", fi, err)
	}
	again, err := loadHostIdentity(dir)
	if err != nil || *again != *id {
		t.Fatal("the identity is not kept")
	}
	root, _, err := id.root()
	if err != nil || !root.IsCA {
		t.Fatalf("root: %v", err)
	}
	host := mustCert(t, []byte(id.HostCertificate))
	if err := host.CheckSignatureFrom(root); err != nil || host.IsCA || host.KeyUsage != x509.KeyUsageDigitalSignature|x509.KeyUsageKeyEncipherment {
		t.Fatalf("host certificate: %v %+v", err, host.KeyUsage)
	}
	if _, err := tls.X509KeyPair([]byte(id.HostCertificate), []byte(id.HostPrivateKey)); err != nil {
		t.Fatal(err)
	}
	devKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	devPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PUBLIC KEY", Bytes: x509.MarshalPKCS1PublicKey(&devKey.PublicKey)})
	dc, err := id.deviceCertificate(devPEM)
	if err != nil {
		t.Fatal(err)
	}
	dev := mustCert(t, dc)
	if dev.CheckSignatureFrom(root) != nil || !dev.PublicKey.(*rsa.PublicKey).Equal(&devKey.PublicKey) || len(dev.SubjectKeyId) != 20 {
		t.Fatal("device certificate does not carry the phone's key under the root")
	}
	// A damaged file is replaced by a new identity.
	writeFile(t, hostIdentityFile(dir), "{")
	if n, err := loadHostIdentity(dir); err != nil || n.HostID == id.HostID {
		t.Fatalf("damaged identity: %v", err)
	}
}

func mustCert(t *testing.T, p []byte) *x509.Certificate {
	b, _ := pem.Decode(p)
	if b == nil {
		t.Fatal("no PEM")
	}
	c, err := x509.ParseCertificate(b.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// The pairing flow against a fake iPhone speaking usbmux, lockdown (with
// TLS after StartSession) and the notification proxy: an unpaired phone
// shows Trust, pairs once its owner taps it, and is trusted with a session;
// the next connection needs no Trust; a phone that forgot the unit pairs
// again.
func TestIPhoneTrust(t *testing.T) {
	dir := t.TempDir()
	phone := newFakePhone(t)
	var mu sync.Mutex
	var notes []string
	note := func(s string) {
		mu.Lock()
		notes = append(notes, s)
		mu.Unlock()
		if s == trustTapNote {
			go phone.tap()
		}
	}
	trust := func() error {
		m, err := openMux(phone.pipe())
		if err != nil {
			return err
		}
		defer m.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return iphoneTrust(ctx, m, dir, note)
	}
	if err := trust(); err != nil {
		t.Fatal(err)
	}
	id, _ := loadHostIdentity(dir)
	if phone.pairedHost() != id.HostID || phone.sessions() != 1 || phone.pairs() != 2 {
		t.Fatalf("first connection: paired %q sessions %d pairs %d", phone.pairedHost(), phone.sessions(), phone.pairs())
	}
	if want := []string{trustTapNote, ""}; !reflect.DeepEqual(notes, want) {
		t.Fatalf("notes %q, want %q", notes, want)
	}
	notes = nil
	if err := trust(); err != nil || phone.sessions() != 2 || phone.pairs() != 2 || notes != nil {
		t.Fatalf("second connection: %v, sessions %d, pairs %d, notes %q", err, phone.sessions(), phone.pairs(), notes)
	}
	phone.forget()
	if err := trust(); err != nil || phone.pairedHost() != id.HostID || phone.sessions() != 3 {
		t.Fatalf("after the phone forgot: %v", err)
	}
}

// fakePhone is the phone's side of usbmux on one interface.
type fakePhone struct {
	t      *testing.T
	key    *rsa.PrivateKey
	tlsKey tls.Certificate

	mu       sync.Mutex
	out      chan []byte
	v2       bool
	conns    map[uint16]*fakeConn // by the host's port
	tapped   bool
	host     string // paired HostID
	hostCert []byte
	nSession int
	nPair    int
	watchers []net.Conn
}

func newFakePhone(t *testing.T) *fakePhone {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	return &fakePhone{t: t, key: key, tlsKey: tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key},
		out: make(chan []byte, 256), conns: map[uint16]*fakeConn{}}
}

func (p *fakePhone) pairedHost() string { p.mu.Lock(); defer p.mu.Unlock(); return p.host }
func (p *fakePhone) sessions() int      { p.mu.Lock(); defer p.mu.Unlock(); return p.nSession }
func (p *fakePhone) pairs() int         { p.mu.Lock(); defer p.mu.Unlock(); return p.nPair }

func (p *fakePhone) forget() {
	p.mu.Lock()
	p.host, p.hostCert, p.tapped = "", nil, false
	p.mu.Unlock()
}

// tap is the owner tapping Trust and entering the passcode: the phone
// posts request_pair to its watchers.
func (p *fakePhone) tap() {
	time.Sleep(100 * time.Millisecond)
	p.mu.Lock()
	p.tapped = true
	ws := p.watchers
	p.mu.Unlock()
	for _, w := range ws {
		plistSend(w, map[string]any{"Command": "RelayNotification", "Name": notifyRequestPair})
	}
}

// pipe is a fresh connection of the cable: usbmux starts over.
func (p *fakePhone) pipe() muxPipe {
	p.mu.Lock()
	p.v2 = false
	p.mu.Unlock()
	return fakePipe{p}
}

type fakePipe struct{ p *fakePhone }

func (f fakePipe) read(buf []byte, timeoutMS uint32) (int, error) {
	select {
	case b := <-f.p.out:
		return copy(buf, b), nil
	case <-time.After(time.Duration(timeoutMS) * time.Millisecond):
		return 0, syscall.ETIMEDOUT
	}
}

func (f fakePipe) write(b []byte, zlp bool) error {
	p := f.p
	proto := binary.BigEndian.Uint32(b)
	if int(binary.BigEndian.Uint32(b[4:])) != len(b) {
		p.t.Errorf("usbmux length %d for a %d-byte packet", binary.BigEndian.Uint32(b[4:]), len(b))
	}
	p.mu.Lock()
	v2 := p.v2
	p.mu.Unlock()
	switch proto {
	case muxProtoVersion:
		if v2 || len(b) != 20 || binary.BigEndian.Uint32(b[8:]) != 2 {
			p.t.Errorf("VERSION % x", b)
		}
		p.send(muxProtoVersion, []byte{0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0})
	case muxProtoSetup:
		if len(b) != 17 || binary.BigEndian.Uint32(b[8:]) != muxMagic || b[16] != 7 {
			p.t.Errorf("SETUP % x", b)
		}
		p.mu.Lock()
		p.v2 = true
		p.mu.Unlock()
	case muxProtoTCP:
		if !v2 || binary.BigEndian.Uint32(b[8:]) != muxMagic {
			p.t.Errorf("TCP before SETUP")
		}
		p.tcp(b[16:36], b[36:])
	}
	return nil
}

// send queues a packet from the phone (16-byte header once in version 2).
func (p *fakePhone) send(proto uint32, body []byte) {
	p.mu.Lock()
	hl := 8
	if p.v2 {
		hl = 16
	}
	p.mu.Unlock()
	b := make([]byte, hl+len(body))
	binary.BigEndian.PutUint32(b, proto)
	binary.BigEndian.PutUint32(b[4:], uint32(len(b)))
	if hl == 16 {
		binary.BigEndian.PutUint32(b[8:], muxMagic)
	}
	copy(b[hl:], body)
	p.out <- b
}

func (p *fakePhone) sendTCP(c *fakeConn, flags byte, data []byte) {
	th := make([]byte, 20)
	binary.BigEndian.PutUint16(th, c.port)
	binary.BigEndian.PutUint16(th[2:], c.hostPort)
	th[12], th[13] = 0x50, flags
	p.send(muxProtoTCP, append(th, data...))
}

type fakeConn struct {
	port, hostPort uint16
	host, phone    net.Conn // a pipe: the host's TCP payload enters at host
	in             chan []byte
}

func (p *fakePhone) tcp(th, data []byte) {
	hostPort, port, flags := binary.BigEndian.Uint16(th), binary.BigEndian.Uint16(th[2:]), th[13]
	p.mu.Lock()
	c := p.conns[hostPort]
	p.mu.Unlock()
	switch {
	case flags == tcpSYN:
		hostEnd, phoneEnd := net.Pipe()
		c = &fakeConn{port: port, hostPort: hostPort, host: hostEnd, phone: phoneEnd, in: make(chan []byte, 64)}
		p.mu.Lock()
		p.conns[hostPort] = c
		p.mu.Unlock()
		p.sendTCP(c, tcpSYN|tcpACK, nil)
		go func() { // the host's bytes, in order, into the pipe
			for b := range c.in {
				hostEnd.Write(b)
			}
		}()
		go func() { // the service's bytes out to the host
			buf := make([]byte, 4096)
			for {
				n, err := hostEnd.Read(buf)
				if err != nil {
					return
				}
				p.sendTCP(c, tcpACK, append([]byte{}, buf[:n]...))
			}
		}()
		go p.serve(c)
	case c == nil:
	case flags&tcpRST != 0:
		p.mu.Lock()
		delete(p.conns, hostPort)
		p.mu.Unlock()
		close(c.in)
		c.phone.Close()
	case len(data) > 0:
		c.in <- append([]byte{}, data...)
	}
}

func (p *fakePhone) serve(c *fakeConn) {
	switch c.port {
	case lockdownPort:
		p.lockdown(c.phone)
	case 4000: // the notification proxy
		for {
			doc, err := plistRecvRaw(c.phone)
			if err != nil {
				return
			}
			if bytes.Contains(doc, []byte("ObserveNotification")) && bytes.Contains(doc, []byte(notifyRequestPair)) {
				p.mu.Lock()
				p.watchers = append(p.watchers, c.phone)
				p.mu.Unlock()
			}
		}
	}
}

func (p *fakePhone) lockdown(conn net.Conn) {
	var rw io.ReadWriter = conn
	for {
		doc, err := plistRecvRaw(rw)
		if err != nil {
			return
		}
		v, err := plistDecode(doc)
		if err != nil {
			p.t.Errorf("lockdown request: %v", err)
			return
		}
		req := v.(map[string]any)
		if req["Label"] != lockdownLabel {
			p.t.Errorf("no Label: %v", req)
		}
		resp, startTLS := p.answer(req)
		resp["Request"] = req["Request"]
		plistSend(rw, resp)
		if startTLS {
			tc := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{p.tlsKey}, ClientAuth: tls.RequireAnyClientCert})
			if err := tc.Handshake(); err != nil {
				p.t.Errorf("session TLS: %v", err)
				return
			}
			p.mu.Lock()
			ok := bytes.Equal(tc.ConnectionState().PeerCertificates[0].Raw, p.hostCert)
			p.nSession++
			p.mu.Unlock()
			if !ok {
				p.t.Error("session TLS with a certificate other than the paired host's")
			}
			rw = tc
		}
	}
}

func (p *fakePhone) answer(req map[string]any) (map[string]any, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	switch req["Request"] {
	case "QueryType":
		return map[string]any{"Type": lockdownType}, false
	case "GetValue":
		if req["Key"] == "DevicePublicKey" {
			return map[string]any{"Value": pem.EncodeToMemory(&pem.Block{Type: "RSA PUBLIC KEY",
				Bytes: x509.MarshalPKCS1PublicKey(&p.key.PublicKey)})}, false
		}
	case "SetValue", "StopSession":
		return map[string]any{}, false
	case "StartService":
		if req["Service"] == notifyProxy {
			return map[string]any{"Port": int64(4000)}, false
		}
	case "StartSession":
		if p.host == "" || req["HostID"] != p.host {
			return map[string]any{"Error": "InvalidHostID"}, false
		}
		return map[string]any{"SessionID": "S1", "EnableSessionSSL": true}, true
	case "Pair":
		p.nPair++
		if !p.tapped {
			return map[string]any{"Error": "PairingDialogResponsePending"}, false
		}
		rec := req["PairRecord"].(map[string]any)
		root := mustCertNoT(rec["RootCertificate"].([]byte))
		dev := mustCertNoT(rec["DeviceCertificate"].([]byte))
		host := mustCertNoT(rec["HostCertificate"].([]byte))
		if dev == nil || root == nil || host == nil || dev.CheckSignatureFrom(root) != nil ||
			!dev.PublicKey.(*rsa.PublicKey).Equal(&p.key.PublicKey) || host.CheckSignatureFrom(root) != nil {
			return map[string]any{"Error": "InvalidPairRecord"}, false
		}
		p.host, p.hostCert = rec["HostID"].(string), host.Raw
		return map[string]any{"EscrowBag": []byte{1, 2, 3}}, false
	}
	return map[string]any{"Error": "UnknownRequest"}, false
}

func mustCertNoT(p []byte) *x509.Certificate {
	b, _ := pem.Decode(p)
	if b == nil {
		return nil
	}
	c, _ := x509.ParseCertificate(b.Bytes)
	return c
}
