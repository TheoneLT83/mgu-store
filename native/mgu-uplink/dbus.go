package main

// A minimal D-Bus client for the system bus: one method call with string
// arguments, its reply or error. It speaks the wire protocol itself
// (SASL EXTERNAL, Hello, one call), so no stock tool runs for it.

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

var systemBusSocket = "/var/run/dbus/system_bus_socket"

const (
	dbusMethodCall   = 1
	dbusMethodReturn = 2
	dbusError        = 3

	dbusFieldPath        = 1
	dbusFieldInterface   = 2
	dbusFieldMember      = 3
	dbusFieldErrorName   = 4
	dbusFieldReplySerial = 5
	dbusFieldDestination = 6
	dbusFieldSignature   = 8
)

var errDBusNoAnswer = errors.New("D-Bus: no answer")

// dbusErrorReply is an error reply: its name, and its message when it has one.
type dbusErrorReply struct{ name, msg string }

func (e *dbusErrorReply) Error() string {
	if e.msg == "" {
		return e.name
	}
	return e.name + ": " + e.msg
}

// dbusCall calls dest's member on path/iface with string arguments over the
// system bus, all within timeout. A reply is nil; an error reply is a
// *dbusErrorReply.
func dbusCall(timeout time.Duration, dest, path, iface, member string, args ...string) error {
	c, err := net.DialTimeout("unix", systemBusSocket, timeout)
	if err != nil {
		return err
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(timeout))
	err = dbusCallOn(c, dest, path, iface, member, args)
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return errDBusNoAnswer
	}
	return err
}

func dbusCallOn(c net.Conn, dest, path, iface, member string, args []string) error {
	r := bufio.NewReader(c)
	uid := hex.EncodeToString([]byte(strconv.Itoa(os.Getuid())))
	if _, err := io.WriteString(c, "\x00AUTH EXTERNAL "+uid+"\r\n"); err != nil {
		return err
	}
	line, err := r.ReadString('\n')
	if err != nil {
		return err
	}
	if !strings.HasPrefix(line, "OK ") {
		return fmt.Errorf("D-Bus: authentication refused: %s", strings.TrimSpace(line))
	}
	if _, err := io.WriteString(c, "BEGIN\r\n"); err != nil {
		return err
	}
	hello := dbusMessage(1, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "Hello", nil)
	call := dbusMessage(2, dest, path, iface, member, args)
	if _, err := c.Write(append(hello, call...)); err != nil {
		return err
	}
	for {
		typ, replyTo, errName, body, err := dbusRead(r)
		if err != nil {
			return err
		}
		if replyTo != 2 {
			continue // Hello's reply, the NameAcquired signal
		}
		switch typ {
		case dbusMethodReturn:
			return nil
		case dbusError:
			return &dbusErrorReply{name: errName, msg: body}
		}
	}
}

// dbusMessage is a little-endian method call with string arguments.
func dbusMessage(serial uint32, dest, path, iface, member string, args []string) []byte {
	var body []byte
	for _, a := range args {
		body = dbusString(body, a)
	}
	var f []byte
	field := func(code byte, sig byte, v string) {
		f = dbusPad(f, 8)
		f = append(f, code, 1, sig, 0)
		if sig == 'g' {
			f = append(append(append(f, byte(len(v))), v...), 0)
		} else {
			f = dbusString(f, v)
		}
	}
	field(dbusFieldPath, 'o', path)
	field(dbusFieldInterface, 's', iface)
	field(dbusFieldMember, 's', member)
	field(dbusFieldDestination, 's', dest)
	if len(args) > 0 {
		field(dbusFieldSignature, 'g', strings.Repeat("s", len(args)))
	}
	m := []byte{'l', dbusMethodCall, 0, 1}
	m = binary.LittleEndian.AppendUint32(m, uint32(len(body)))
	m = binary.LittleEndian.AppendUint32(m, serial)
	m = binary.LittleEndian.AppendUint32(m, uint32(len(f)))
	m = dbusPad(append(m, f...), 8)
	return append(m, body...)
}

func dbusPad(b []byte, n int) []byte {
	for len(b)%n != 0 {
		b = append(b, 0)
	}
	return b
}

// dbusString appends a string (or object path), aligned to 4.
func dbusString(b []byte, s string) []byte {
	b = binary.LittleEndian.AppendUint32(dbusPad(b, 4), uint32(len(s)))
	return append(append(b, s...), 0)
}

// dbusRead reads one message: its type, the serial it replies to, an
// error's name and, when the body starts with a string, that string.
func dbusRead(r io.Reader) (typ byte, replyTo uint32, errName, first string, err error) {
	h := make([]byte, 16)
	if _, err = io.ReadFull(r, h); err != nil {
		return
	}
	var o binary.ByteOrder = binary.LittleEndian
	switch h[0] {
	case 'l':
	case 'B':
		o = binary.BigEndian
	default:
		return 0, 0, "", "", errors.New("D-Bus: bad message")
	}
	bodyLen, fieldsLen := o.Uint32(h[4:]), o.Uint32(h[12:])
	if bodyLen > 1<<20 || fieldsLen > 1<<16 {
		return 0, 0, "", "", errors.New("D-Bus: message too long")
	}
	rest := make([]byte, (int(fieldsLen)+7)&^7+int(bodyLen))
	if _, err = io.ReadFull(r, rest); err != nil {
		return
	}
	typ = h[1]
	f, body := rest[:fieldsLen], rest[(int(fieldsLen)+7)&^7:]
	var sig string
	// The fields start at offset 16 and the body at a multiple of 8, so
	// alignment inside each matches the message's.
	for i := 0; i < len(f); {
		i = (i + 7) &^ 7
		if i+4 > len(f) || f[i+1] != 1 {
			return 0, 0, "", "", errors.New("D-Bus: bad header field")
		}
		code, t := f[i], f[i+2]
		i += 4
		switch t {
		case 's', 'o':
			var s string
			if s, i, err = dbusReadString(f, i, o); err != nil {
				return
			}
			if code == dbusFieldErrorName {
				errName = s
			}
		case 'g':
			if i >= len(f) || i+int(f[i])+2 > len(f) {
				return 0, 0, "", "", errors.New("D-Bus: bad header field")
			}
			if code == dbusFieldSignature {
				sig = string(f[i+1 : i+1+int(f[i])])
			}
			i += int(f[i]) + 2
		case 'u':
			i = (i + 3) &^ 3
			if i+4 > len(f) {
				return 0, 0, "", "", errors.New("D-Bus: bad header field")
			}
			if code == dbusFieldReplySerial {
				replyTo = o.Uint32(f[i:])
			}
			i += 4
		default:
			return 0, 0, "", "", fmt.Errorf("D-Bus: header field type %q", t)
		}
	}
	if strings.HasPrefix(sig, "s") {
		first, _, _ = dbusReadString(body, 0, o)
	}
	return typ, replyTo, errName, first, nil
}

func dbusReadString(b []byte, i int, o binary.ByteOrder) (string, int, error) {
	i = (i + 3) &^ 3
	if i+4 > len(b) {
		return "", 0, errors.New("D-Bus: bad string")
	}
	n := int(o.Uint32(b[i:]))
	i += 4
	if n < 0 || i+n+1 > len(b) || b[i+n] != 0 {
		return "", 0, errors.New("D-Bus: bad string")
	}
	return string(b[i : i+n]), i + n + 1, nil
}
