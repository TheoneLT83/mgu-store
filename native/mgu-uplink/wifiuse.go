package main

// What the stock system does with the Wi-Fi interface (wifi.go stockUse):
// the provider takes the interface only while none of it holds, so the
// car's own Wi-Fi, hotspot and wireless CarPlay keep working.

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/vishvananda/netlink"
	"github.com/vishvananda/netlink/nl"
	"golang.org/x/sys/unix"
)

// nl80211 (linux/nl80211.h)
const (
	nl80211CmdGetInterface = 5
	nl80211AttrIfindex     = 3
	nl80211AttrIftype      = 5
	nl80211Station         = 2
)

var nl80211Iftypes = map[uint32]string{
	1: "ad-hoc", 3: "access point", 4: "AP VLAN", 5: "WDS", 6: "monitor", 7: "mesh",
	8: "P2P client", 9: "P2P group owner", 10: "P2P device", 11: "OCB", 12: "NAN",
}

func iftypeName(t uint32) string {
	if n, ok := nl80211Iftypes[t]; ok {
		return n
	}
	return fmt.Sprintf("type %d", t)
}

func nl80211Iftype(iface string) (uint32, error) {
	link, err := netlink.LinkByName(iface)
	if err != nil {
		return 0, err
	}
	fam, err := netlink.GenlFamilyGet("nl80211")
	if err != nil {
		return 0, fmt.Errorf("nl80211: %v", err)
	}
	req := nl.NewNetlinkRequest(int(fam.ID), 0)
	req.AddData(&nl.Genlmsg{Command: nl80211CmdGetInterface})
	req.AddData(nl.NewRtAttr(nl80211AttrIfindex, nl.Uint32Attr(uint32(link.Attrs().Index))))
	msgs, err := req.Execute(unix.NETLINK_GENERIC, 0)
	if err != nil {
		return 0, fmt.Errorf("nl80211: %v", err)
	}
	for _, m := range msgs {
		if len(m) < nl.SizeofGenlmsg {
			continue
		}
		attrs, err := nl.ParseRouteAttr(m[nl.SizeofGenlmsg:])
		if err != nil {
			return 0, fmt.Errorf("nl80211: %v", err)
		}
		for _, a := range attrs {
			if a.Attr.Type == nl80211AttrIftype && len(a.Value) >= 4 {
				return nl.NativeEndian().Uint32(a.Value), nil
			}
		}
	}
	return 0, errors.New("nl80211: no interface type")
}

// dbusSupplicantHas asks the D-Bus wpa_supplicant (fi.w1.wpa_supplicant1)
// whether it has iface, giving up after 3 s.
func dbusSupplicantHas(iface string) (bool, error) {
	err := dbusCall(3*time.Second, "fi.w1.wpa_supplicant1", "/fi/w1/wpa_supplicant1",
		"fi.w1.wpa_supplicant1", "GetInterface", iface)
	var e *dbusErrorReply
	switch {
	case err == nil:
		return true, nil
	case errors.As(err, &e) && e.name == "fi.w1.wpa_supplicant1.InterfaceUnknown":
		return false, nil
	}
	return false, err
}

type stockUse struct {
	why     string // a process that uses the interface
	connman string // connman manages it
	dbus    bool   // a D-Bus wpa_supplicant runs (ask it: dbusHas)
}

// stockUsers looks through the processes under proc for users of iface:
// hostapd on it, a wpa_supplicant not on conf (ours) on it, and notes
// connman managing it (connConf: its main.conf) and a D-Bus wpa_supplicant.
func stockUsers(proc, iface, conf, connConf string) stockUse {
	var u stockUse
	dirs, _ := os.ReadDir(proc)
	for _, d := range dirs {
		pid, err := strconv.Atoi(d.Name())
		if err != nil || pid == os.Getpid() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(proc, d.Name(), "cmdline"))
		if err != nil || len(b) == 0 {
			continue
		}
		args := strings.Split(strings.TrimRight(string(b), "\x00"), "\x00")
		switch base := filepath.Base(args[0]); {
		case strings.Contains(base, "hostapd"):
			if hostapdOn(args[1:], iface) {
				return stockUse{why: fmt.Sprintf("hostapd runs on %s", iface)}
			}
		case strings.Contains(base, "wpa_supplicant"):
			on, own, dbus := false, false, false
			for i, a := range args {
				on = on || a == "-i"+iface || a == "-i" && i+1 < len(args) && args[i+1] == iface
				own = own || a == conf || a == "-c"+conf
				dbus = dbus || i > 0 && strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "--") && optionLetters(a, 'u')
			}
			switch {
			case own:
			case on:
				return stockUse{why: fmt.Sprintf("another wpa_supplicant runs on %s", iface)}
			case dbus:
				u.dbus = true
			}
		case base == "connmand" || strings.HasPrefix(base, "connmand_"): // connmand_nxp on the 88W9098 units
			if connmanManages(args[1:], iface, connConf) {
				u.connman = fmt.Sprintf("connman manages %s", iface)
			}
		}
	}
	return u
}

// optionLetters: a cluster of wpa_supplicant's one-letter flags such as
// -dduB holds c. What follows a letter that takes a value (-c, -i, ...) is
// that value.
func optionLetters(a string, c byte) bool {
	for i := 1; i < len(a); i++ {
		if a[i] == c {
			return true
		}
		if strings.IndexByte("bcCDefgGiImoOpP", a[i]) >= 0 {
			return false
		}
	}
	return false
}

// hostapdOn: hostapd's -i list, or one of its config files, names iface.
func hostapdOn(args []string, iface string) bool {
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-i" && i+1 < len(args):
			i++
			for _, n := range strings.Split(args[i], ",") {
				if n == iface {
					return true
				}
			}
		case strings.HasPrefix(a, "-i"):
			for _, n := range strings.Split(a[2:], ",") {
				if n == iface {
					return true
				}
			}
		case len(a) == 2 && strings.IndexByte("PfeEgGbSz", a[1]) >= 0 && a[0] == '-':
			i++ // an option's value
		case !strings.HasPrefix(a, "-"):
			if confNames(a, "interface", iface) {
				return true
			}
		}
	}
	return false
}

// confNames: the key=value file at path sets key to val.
func confNames(path, key, val string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "="); ok && k == key && strings.TrimSpace(v) == val {
			return true
		}
	}
	return false
}

// connmanManages follows connmand's device filter: -i/--device (patterns:
// only those), -I/--nodevice (patterns: not those), main.conf's
// NetworkInterfaceBlacklist (prefixes: not those), and the wifi plugin
// (-p/--plugin, -P/--noplugin).
func connmanManages(args []string, iface, mainConf string) bool {
	var only, not []string
	plugins, noPlugins := "", ""
	short := map[string]string{"-i": "--device", "-I": "--nodevice", "-p": "--plugin", "-P": "--noplugin", "-c": "--config"}
	for i := 0; i < len(args); i++ {
		name, val, hasVal := strings.Cut(args[i], "=")
		if len(name) > 2 && name[1] != '-' && short[name[:2]] != "" {
			name, val, hasVal = name[:2], name[2:], true
		}
		if l, ok := short[name]; ok {
			name = l
		}
		switch name {
		case "--device", "--nodevice", "--plugin", "--noplugin", "--config":
			if !hasVal && i+1 < len(args) {
				i++
				val = args[i]
			}
		default:
			continue
		}
		switch name {
		case "--device":
			only = append(only, strings.Split(val, ",")...)
		case "--nodevice":
			not = append(not, strings.Split(val, ",")...)
		case "--plugin":
			plugins += "," + val
		case "--noplugin":
			noPlugins += "," + val
		case "--config":
			mainConf = val
		}
	}
	if plugins != "" && !matchAny(strings.Split(plugins, ","), "wifi") || matchAny(strings.Split(noPlugins, ","), "wifi") {
		return false
	}
	if only != nil && !matchAny(only, iface) || matchAny(not, iface) || strings.HasPrefix(iface, "dummy") {
		return false
	}
	for _, p := range iniList(mainConf, "NetworkInterfaceBlacklist") {
		if strings.HasPrefix(iface, p) {
			return false
		}
	}
	return true
}

func matchAny(patterns []string, s string) bool {
	for _, p := range patterns {
		if ok, _ := path.Match(p, s); ok && p != "" {
			return true
		}
	}
	return false
}

// iniList reads a comma-separated key from a GLib key file.
func iniList(file, key string) []string {
	b, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	var out []string
	for _, l := range strings.Split(string(b), "\n") {
		if k, v, ok := strings.Cut(l, "="); ok && strings.TrimSpace(k) == key {
			out = nil
			for _, s := range strings.Split(v, ",") {
				if s = strings.TrimSpace(s); s != "" {
					out = append(out, s)
				}
			}
		}
	}
	return out
}
