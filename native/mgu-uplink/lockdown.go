package main

// lockdown: the iPhone's pairing and session service (port 62078 over
// usbmux), as libimobiledevice's lockdown.c drives it. Each message is a
// 4-byte big-endian length and an XML property list; a request is a dict
// with "Label" and "Request", the answer echoes "Request" and carries
// "Error" when it failed. The plist codec here covers what lockdown and the
// notification proxy exchange: dict, array, string, integer, real, bool,
// data and date.

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	lockdownPort  = 62078
	lockdownLabel = "mgu-uplink"
	lockdownMax   = 1 << 20
	lockdownTO    = 10 * time.Second
)

// plistEncode writes v (map[string]any, []any, string, bool, int, int64,
// uint64, []byte) as an XML property list document.
func plistEncode(v any) ([]byte, error) {
	var b bytes.Buffer
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` + "\n" +
		`<plist version="1.0">` + "\n")
	if err := plistValue(&b, v); err != nil {
		return nil, err
	}
	b.WriteString("</plist>\n")
	return b.Bytes(), nil
}

func plistValue(b *bytes.Buffer, v any) error {
	switch v := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteString("<dict>\n")
		for _, k := range keys {
			b.WriteString("<key>")
			xml.EscapeText(b, []byte(k))
			b.WriteString("</key>\n")
			if err := plistValue(b, v[k]); err != nil {
				return err
			}
		}
		b.WriteString("</dict>\n")
	case []any:
		b.WriteString("<array>\n")
		for _, e := range v {
			if err := plistValue(b, e); err != nil {
				return err
			}
		}
		b.WriteString("</array>\n")
	case string:
		b.WriteString("<string>")
		xml.EscapeText(b, []byte(v))
		b.WriteString("</string>\n")
	case bool:
		if v {
			b.WriteString("<true/>\n")
		} else {
			b.WriteString("<false/>\n")
		}
	case int:
		fmt.Fprintf(b, "<integer>%d</integer>\n", v)
	case int64:
		fmt.Fprintf(b, "<integer>%d</integer>\n", v)
	case uint64:
		fmt.Fprintf(b, "<integer>%d</integer>\n", v)
	case []byte:
		fmt.Fprintf(b, "<data>%s</data>\n", base64.StdEncoding.EncodeToString(v))
	default:
		return fmt.Errorf("plist: cannot encode %T", v)
	}
	return nil
}

// plistDecode reads an XML property list document. Integers come back as
// int64 (uint64 above its range), reals as float64, dates as strings.
func plistDecode(doc []byte) (any, error) {
	if bytes.HasPrefix(doc, []byte("bplist")) {
		return nil, errors.New("plist: binary property lists are not supported")
	}
	d := xml.NewDecoder(bytes.NewReader(doc))
	for {
		tok, err := d.Token()
		if err != nil {
			return nil, fmt.Errorf("plist: %v", err)
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local != "plist" {
			return plistElement(d, se)
		}
	}
}

func plistElement(d *xml.Decoder, se xml.StartElement) (any, error) {
	switch se.Name.Local {
	case "dict":
		m := map[string]any{}
		for {
			tok, err := d.Token()
			if err != nil {
				return nil, err
			}
			switch t := tok.(type) {
			case xml.EndElement:
				return m, nil
			case xml.StartElement:
				if t.Name.Local != "key" {
					return nil, fmt.Errorf("plist: <%s> where a key belongs", t.Name.Local)
				}
				var k string
				if err := d.DecodeElement(&k, &t); err != nil {
					return nil, err
				}
				vt, err := nextStart(d)
				if err != nil {
					return nil, err
				}
				if m[k], err = plistElement(d, vt); err != nil {
					return nil, err
				}
			}
		}
	case "array":
		a := []any{}
		for {
			tok, err := d.Token()
			if err != nil {
				return nil, err
			}
			switch t := tok.(type) {
			case xml.EndElement:
				return a, nil
			case xml.StartElement:
				v, err := plistElement(d, t)
				if err != nil {
					return nil, err
				}
				a = append(a, v)
			}
		}
	case "true", "false":
		if err := d.Skip(); err != nil {
			return nil, err
		}
		return se.Name.Local == "true", nil
	}
	var text string
	if err := d.DecodeElement(&text, &se); err != nil {
		return nil, err
	}
	switch se.Name.Local {
	case "string", "date":
		return text, nil
	case "integer":
		text = strings.TrimSpace(text)
		if i, err := strconv.ParseInt(text, 10, 64); err == nil {
			return i, nil
		}
		return strconv.ParseUint(text, 10, 64)
	case "real":
		return strconv.ParseFloat(strings.TrimSpace(text), 64)
	case "data":
		return base64.StdEncoding.DecodeString(strings.Map(func(r rune) rune {
			if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
				return -1
			}
			return r
		}, text))
	}
	return nil, fmt.Errorf("plist: unknown element <%s>", se.Name.Local)
}

func nextStart(d *xml.Decoder) (xml.StartElement, error) {
	for {
		tok, err := d.Token()
		if err != nil {
			return xml.StartElement{}, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			return t, nil
		case xml.EndElement:
			return xml.StartElement{}, errors.New("plist: key without a value")
		}
	}
}

// plistSend writes one length-prefixed plist message.
func plistSend(w io.Writer, v any) error {
	doc, err := plistEncode(v)
	if err != nil {
		return err
	}
	msg := make([]byte, 4+len(doc))
	binary.BigEndian.PutUint32(msg, uint32(len(doc)))
	copy(msg[4:], doc)
	_, err = w.Write(msg)
	return err
}

// plistRecvRaw reads one length-prefixed message without decoding it.
func plistRecvRaw(r io.Reader) ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > lockdownMax {
		return nil, fmt.Errorf("lockdown: %d-byte message", n)
	}
	doc := make([]byte, n)
	_, err := io.ReadFull(r, doc)
	return doc, err
}

// lockdownError is the "Error" string of a failed request:
// InvalidHostID, PairingDialogResponsePending, PasswordProtected,
// UserDeniedPairing, ...
type lockdownError string

func (e lockdownError) Error() string { return "lockdown: " + string(e) }

func isLockdownError(err error, name string) bool {
	var le lockdownError
	return errors.As(err, &le) && string(le) == name
}

// lockdownClient is one connection to lockdown; after StartSession with
// EnableSessionSSL it runs inside TLS.
type lockdownClient struct {
	raw     *muxConn
	conn    net.Conn
	session string
}

func dialLockdown(m *usbMux) (*lockdownClient, error) {
	c, err := m.Dial(lockdownPort)
	if err != nil {
		return nil, err
	}
	return &lockdownClient{raw: c, conn: c}, nil
}

func (l *lockdownClient) Close() {
	if l.session != "" {
		l.call(map[string]any{"Request": "StopSession", "SessionID": l.session})
		l.session = ""
	}
	l.conn.Close()
	l.raw.Close()
}

// call sends a request and returns the answer; an answer with "Error" is
// returned with a lockdownError.
func (l *lockdownClient) call(req map[string]any) (map[string]any, error) {
	req["Label"] = lockdownLabel
	l.conn.SetReadDeadline(time.Now().Add(lockdownTO))
	defer l.conn.SetReadDeadline(time.Time{})
	if err := plistSend(l.conn, req); err != nil {
		return nil, err
	}
	doc, err := plistRecvRaw(l.conn)
	if err != nil {
		return nil, fmt.Errorf("lockdown %s: %w", req["Request"], err)
	}
	v, err := plistDecode(doc)
	if err != nil {
		return nil, err
	}
	resp, ok := v.(map[string]any)
	if !ok {
		return nil, errors.New("lockdown: answer is not a dict")
	}
	if e, ok := resp["Error"].(string); ok {
		return resp, lockdownError(e)
	}
	return resp, nil
}

func (l *lockdownClient) queryType() (string, error) {
	resp, err := l.call(map[string]any{"Request": "QueryType"})
	if err != nil {
		return "", err
	}
	t, _ := resp["Type"].(string)
	return t, nil
}

func (l *lockdownClient) getValue(key string) (any, error) {
	resp, err := l.call(map[string]any{"Request": "GetValue", "Key": key})
	if err != nil {
		return nil, err
	}
	return resp["Value"], nil
}

func (l *lockdownClient) setValue(domain, key string, value any) error {
	_, err := l.call(map[string]any{"Request": "SetValue", "Domain": domain, "Key": key, "Value": value})
	return err
}

// startService starts a lockdown service and returns its port.
func (l *lockdownClient) startService(name string) (uint16, error) {
	resp, err := l.call(map[string]any{"Request": "StartService", "Service": name})
	if err != nil {
		return 0, err
	}
	p, ok := resp["Port"].(int64)
	if !ok || p <= 0 || p > 65535 {
		return 0, fmt.Errorf("lockdown StartService %s: no port", name)
	}
	return uint16(p), nil
}

// startSession opens a session as the paired host; the phone then trusts
// this host for this connection of the cable.
func (l *lockdownClient) startSession(id *hostIdentity) error {
	resp, err := l.call(map[string]any{"Request": "StartSession", "HostID": id.HostID, "SystemBUID": id.SystemBUID})
	if err != nil {
		return err
	}
	l.session, _ = resp["SessionID"].(string)
	if ssl, _ := resp["EnableSessionSSL"].(bool); !ssl {
		return nil
	}
	cert, err := tls.X509KeyPair([]byte(id.HostCertificate), []byte(id.HostPrivateKey))
	if err != nil {
		return err
	}
	tc := tls.Client(l.raw, &tls.Config{
		// The phone's certificate is its own self-signed one: nothing to
		// verify it against. The pairing is what authenticates both ends.
		InsecureSkipVerify: true,
		Certificates:       []tls.Certificate{cert},
	})
	l.raw.SetReadDeadline(time.Now().Add(lockdownTO))
	err = tc.Handshake()
	l.raw.SetReadDeadline(time.Time{})
	if err != nil {
		return fmt.Errorf("lockdown session TLS: %w", err)
	}
	l.conn = tc
	return nil
}

// pair asks the phone to pair with this host, with the device certificate
// made for it. On the first request the phone shows "Trust This Computer?"
// and answers PairingDialogResponsePending; once its owner taps Trust and
// enters the passcode the same request succeeds. The answer's EscrowBag is
// returned.
func (l *lockdownClient) pair(id *hostIdentity, deviceCert []byte) ([]byte, error) {
	resp, err := l.call(map[string]any{
		"Request":         "Pair",
		"ProtocolVersion": "2",
		"PairRecord": map[string]any{
			"DeviceCertificate": deviceCert,
			"HostCertificate":   []byte(id.HostCertificate),
			"RootCertificate":   []byte(id.RootCertificate),
			"HostID":            id.HostID,
			"SystemBUID":        id.SystemBUID,
		},
		"PairingOptions": map[string]any{"ExtendedPairingErrors": true},
	})
	if err != nil {
		return nil, err
	}
	bag, _ := resp["EscrowBag"].([]byte)
	return bag, nil
}
