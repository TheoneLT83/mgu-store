package main

import (
	"bufio"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeBus serves the system bus socket: SASL, then for each method call the
// answer reply gives (a method return, an error, or nothing), after a
// NameAcquired-like signal on the Hello. order picks the reply's byte order.
func fakeBus(t *testing.T, order byte, reply func(member string, args []string) (errName string, ok bool)) {
	t.Helper()
	sock := filepath.Join(t.TempDir(), "bus")
	l, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	old := systemBusSocket
	systemBusSocket = sock
	t.Cleanup(func() { systemBusSocket = old })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go serveFakeBus(c, order, reply)
		}
	}()
}

func serveFakeBus(c net.Conn, order byte, reply func(string, []string) (string, bool)) {
	defer c.Close()
	r := bufio.NewReader(c)
	if b, _ := r.ReadByte(); b != 0 {
		return
	}
	if l, _ := r.ReadString('\n'); !strings.HasPrefix(l, "AUTH EXTERNAL ") {
		c.Write([]byte("REJECTED EXTERNAL\r\n"))
		return
	}
	c.Write([]byte("OK 0123456789abcdef0123456789abcdef\r\n"))
	if l, _ := r.ReadString('\n'); l != "BEGIN\r\n" {
		return
	}
	var serial uint32 = 100
	for {
		m, err := readCall(r)
		if err != nil {
			return
		}
		serial++
		if m.member == "Hello" {
			c.Write(fakeMessage(order, dbusMethodReturn, serial, m.serial, "", "s", ":1.42"))
			serial++
			c.Write(fakeMessage(order, 4, serial, 0, "", "s", ":1.42"))
			continue
		}
		errName, ok := reply(m.member, m.args)
		if !ok {
			continue
		}
		if errName != "" {
			c.Write(fakeMessage(order, dbusError, serial, m.serial, errName, "s", "no such interface"))
		} else {
			c.Write(fakeMessage(order, dbusMethodReturn, serial, m.serial, "", "o", "/fi/w1/wpa_supplicant1/Interfaces/0"))
		}
	}
}

type fakeCall struct {
	serial uint32
	member string
	args   []string
}

// readCall parses a call as dbusMessage writes it: its serial, member and
// string arguments.
func readCall(r *bufio.Reader) (fakeCall, error) {
	h, err := r.Peek(16)
	if err != nil {
		return fakeCall{}, err
	}
	bodyLen, fieldsLen := binary.LittleEndian.Uint32(h[4:]), binary.LittleEndian.Uint32(h[12:])
	m := make([]byte, 16+(int(fieldsLen)+7)&^7+int(bodyLen))
	if _, err := io.ReadFull(r, m); err != nil {
		return fakeCall{}, err
	}
	c := fakeCall{serial: binary.LittleEndian.Uint32(m[8:])}
	f := m[16 : 16+fieldsLen]
	for i := 0; i < len(f); {
		i = (i + 7) &^ 7
		code, t := f[i], f[i+2]
		i += 4
		if t == 'g' {
			i += int(f[i]) + 2
			continue
		}
		var s string
		s, i, _ = dbusReadString(f, i, binary.LittleEndian)
		if code == dbusFieldMember {
			c.member = s
		}
	}
	body := m[16+(int(fieldsLen)+7)&^7:]
	for i := 0; i < len(body); {
		var s string
		if s, i, err = dbusReadString(body, i, binary.LittleEndian); err != nil {
			return c, err
		}
		c.args = append(c.args, s)
	}
	return c, nil
}

// fakeMessage is a message from the bus in byte order order ('l' or 'B')
// with a one-value body of signature sig ("s" or "o").
func fakeMessage(order, typ byte, serial, replyTo uint32, errName, sig, val string) []byte {
	var o binary.AppendByteOrder = binary.LittleEndian
	if order == 'B' {
		o = binary.BigEndian
	}
	str := func(b []byte, s string) []byte {
		b = o.AppendUint32(dbusPad(b, 4), uint32(len(s)))
		return append(append(b, s...), 0)
	}
	var f []byte
	if replyTo != 0 {
		f = append(f, dbusFieldReplySerial, 1, 'u', 0)
		f = o.AppendUint32(f, replyTo)
	} else {
		f = append(f, dbusFieldPath, 1, 'o', 0)
		f = str(f, "/org/freedesktop/DBus")
	}
	if errName != "" {
		f = dbusPad(f, 8)
		f = append(f, dbusFieldErrorName, 1, 's', 0)
		f = str(f, errName)
	}
	f = dbusPad(f, 8)
	f = append(f, dbusFieldSignature, 1, 'g', 0, 1, sig[0], 0)
	body := str(nil, val)
	m := []byte{order, typ, 0, 1}
	m = o.AppendUint32(m, uint32(len(body)))
	m = o.AppendUint32(m, serial)
	m = o.AppendUint32(m, uint32(len(f)))
	return append(dbusPad(append(m, f...), 8), body...)
}

// The D-Bus wpa_supplicant's answer: it has the interface, it does not, an
// error, or no answer within the timeout; in either byte order.
func TestDBusSupplicantHas(t *testing.T) {
	for _, order := range []byte{'l', 'B'} {
		var got fakeCall
		fakeBus(t, order, func(member string, args []string) (string, bool) {
			got = fakeCall{member: member, args: args}
			switch args[0] {
			case "wlan1":
				return "", true
			case "wlan0":
				return "fi.w1.wpa_supplicant1.InterfaceUnknown", true
			case "wfd0":
				return "org.freedesktop.DBus.Error.ServiceUnknown", true
			}
			return "", false
		})
		if has, err := dbusSupplicantHas("wlan1"); !has || err != nil {
			t.Errorf("%c wlan1: %v %v, want true", order, has, err)
		}
		if got.member != "GetInterface" || len(got.args) != 1 || got.args[0] != "wlan1" {
			t.Errorf("%c call: %+v", order, got)
		}
		if has, err := dbusSupplicantHas("wlan0"); has || err != nil {
			t.Errorf("%c wlan0: %v %v, want false", order, has, err)
		}
		if _, err := dbusSupplicantHas("wfd0"); err == nil || err.Error() != "org.freedesktop.DBus.Error.ServiceUnknown: no such interface" {
			t.Errorf("%c wfd0: %v", order, err)
		}
	}
}

func TestDBusNoAnswer(t *testing.T) {
	fakeBus(t, 'l', func(string, []string) (string, bool) { return "", false })
	start := time.Now()
	err := dbusCall(300*time.Millisecond, "fi.w1.wpa_supplicant1", "/fi/w1/wpa_supplicant1",
		"fi.w1.wpa_supplicant1", "GetInterface", "wlan1")
	if !errors.Is(err, errDBusNoAnswer) || time.Since(start) > 2*time.Second {
		t.Errorf("%v after %v, want no answer", err, time.Since(start))
	}
	systemBusSocket = filepath.Join(t.TempDir(), "none")
	if _, err := dbusSupplicantHas("wlan1"); err == nil {
		t.Error("no bus: no error")
	}
}
