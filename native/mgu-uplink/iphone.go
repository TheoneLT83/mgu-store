package main

// An iPhone's Personal Hotspot over USB. The phone serves the hotspot only
// to a host it trusts, so besides the hotspot interface the uplink claims
// the phone's usbmux interface and opens a lockdown session as a paired
// host on every connection, pairing once when the phone does not know the
// unit (pairing.go). The other obstacle on the head unit is the stock media
// daemon, which grabs a connected iPhone and holds it on configuration 2
// (iAP/iPod media). The uplink takes the device away from it:
//
//	/sys/.../authorized 0    deauthorize: the kernel tears the device down and
//	                         drops every claim, so the media daemon loses it
//	(500 ms)
//	/sys/.../authorized 1    reauthorize: the device is set up again at its
//	                         default configuration (same device number)
//	open /dev/bus/usb/...    on the re-enumerated node
//	SET_CONFIGURATION 4      the configuration holding the hotspot interface
//	CLAIM_INTERFACE          the hotspot interface (ff/fd/01, Linux's ipheth),
//	                         then the usbmux interface (ff/fe/02)
//
// The media daemon races to put the device back on configuration 2, so the
// claim is retried: inner retries for 2 s after each reauthorize, up to six
// reauthorize rounds. Taking the device makes it a network device, not a
// media device, so USB media playback from that iPhone stops while
// tethering and resumes when it ends (close reauthorizes the device so the
// media daemon re-enumerates and reclaims it). Only the one Apple device is
// touched; the media daemon keeps serving every other device.
//
// With the hotspot interface claimed it is brought up as IterioDev's
// ipheth-tether does, and the frames flow as Linux's ipheth and the tether
// carry them:
//
//	alt setting 1  the bulk endpoints, selected first
//	GET_MACADDR    0xc0/0x00: the host-side MAC
//	ENABLE_NCM     0x41/0x04: accepted means NCM framing for what the phone
//	               sends; refused means legacy framing
//	CARRIER_CHECK  0xc0/0x45: 0x04 means Personal Hotspot is sharing; polled
//	               up to 10 times, 500 ms apart, before frames flow, then
//	               every second to report the hotspot's state
//	CLEAR_HALT     on both bulk endpoints, before frames flow
//	TX             one raw Ethernet frame per transfer, no padding, no
//	               zero-length packet
//	RX             64 KiB transfers, 1 s timeout
//	RX legacy      2 bytes of padding, then one frame
//	RX NCM         an NTH16 with its NDP16 at offset 12, up to 22 entries;
//	               an entry that does not fit the transfer is skipped
//	               (4-byte transfers starting 00 01 are the phone's own
//	               control messages, in both framings)
//
// Until the phone trusts the unit it sends nothing and refuses what it is
// sent, so no DHCP lease arrives: while pairing waits for its owner the
// uplink reports `trust-needed` with what to do.

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

const (
	iphethGetMAC      = 0x00
	iphethEnableNCM   = 0x04
	iphethCarrier     = 0x45
	iphethCarrierOn   = 0x04
	iphethRx          = 65536
	iphethRxTimeout   = 1000         // ms
	iphethNCMMin      = nth16Len + 8 // NTH16 and the NDP16 header
	iphethNDPMaxDPE   = 22
	iphethCarrierPoll = time.Second

	// iphoneCarrierTries CARRIER_CHECK polls, iphoneCarrierWait apart,
	// before frames flow.
	iphoneCarrierTries = 10
	iphoneCarrierWait  = 500 * time.Millisecond

	// iphoneGrabTries reauthorize rounds, iphoneGrabWindow of inner claim
	// retries after each, with the paced sleeps the media daemon is raced
	// with.
	iphoneGrabTries    = 6
	iphoneGrabWindow   = 2 * time.Second
	iphoneDeauthHold   = 500 * time.Millisecond
	iphoneConfigSettle = 80 * time.Millisecond
	iphoneClaimRetry   = 50 * time.Millisecond
	iphoneEnumPoll     = 20 * time.Millisecond

	// iphoneTrustRetry: a lockdown session or pairing that failed is tried
	// again after this long.
	iphoneTrustRetry = 10 * time.Second

	// iphoneStallAfter: a phone that trusts the unit and shares its hotspot
	// but has sent nothing this long after the session is taken again, as
	// unplugging and replugging it would; the wait doubles with each retake
	// in a row, up to iphoneStallMax, and a link whose usbmux session ended
	// waits as long before the phone is taken again.
	iphoneStallAfter = 20 * time.Second
	iphoneStallMax   = 5 * time.Minute

	// iphoneDeclinedNote is the status while a phone whose owner declined
	// Trust is left alone.
	iphoneDeclinedNote = "Trust was declined: plug the iPhone in again"
)

// openIPhoneLink takes the iPhone from the media daemon, brings its hotspot
// interface up and starts the relay; the relay then gets the phone to
// trust the unit, with the host identity kept in pairDir. checkPreferred,
// called between reauthorize rounds, ends the attempt when a preferred
// (wired) device appears.
func openIPhoneLink(ctx context.Context, info usbDeviceInfo, fn netFunction, pairDir string, checkPreferred func() error) (Link, error) {
	dev, cur, fn, err := grabIPhone(ctx, info, fn, checkPreferred)
	if err != nil {
		return nil, err
	}
	claimed := []int{fn.dataIface}
	var mux muxPipe
	if fn.muxIface < 0 {
		logf("iPhone %s: no usbmux interface, so no pairing", cur)
	} else if err := dev.claimInterface(fn.muxIface); err != nil {
		logf("iPhone %s: %v; no pairing", cur, err)
	} else {
		claimed = append(claimed, fn.muxIface)
		mux = usbPipe{dev: dev, in: fn.muxIn, out: fn.muxOut, outPacket: fn.muxOutPacket}
	}
	iface := uint16(fn.dataIface)
	// The hotspot interface carries its bulk endpoints on an alternate
	// setting (alt 1 on current iPhones), selected before the vendor
	// requests. A device that exposes them on the default setting has
	// dataAlt 0 and needs no switch.
	if fn.dataAlt != 0 {
		if err := dev.setInterface(fn.dataIface, fn.dataAlt); err != nil {
			for _, n := range claimed {
				dev.releaseInterface(n)
			}
			dev.Close()
			return nil, fmt.Errorf("%s: set interface %d alt %d: %w", cur, fn.dataIface, fn.dataAlt, err)
		}
	}
	buf := make([]byte, 64)
	var mac []byte
	if n, err := dev.control(0xc0, iphethGetMAC, 0, iface, buf, 5000); err == nil && n >= 6 {
		mac = append([]byte{}, buf[:6]...)
	} else {
		logf("%s: GET_MACADDR: %v (%d bytes)", cur, err, n)
		mac = fallbackMAC(cur)
	}
	_, err = dev.control(0x41, iphethEnableNCM, 0, iface, nil, 5000)
	ncm := err == nil
	carrier := iphoneWaitCarrier(ctx, dev, iface)
	dev.clearHalt(fn.bulkIn)
	dev.clearHalt(fn.bulkOut)
	logf("iPhone %s: hotspot interface %d, MAC %s, NCM receive %v, carrier %v", cur, fn.dataIface, net.HardwareAddr(mac), ncm, carrier)
	fr := &iphethFramer{dev: dev, iface: iface, ncm: ncm, authPath: authorizedPath(cur), sysName: cur.sysName, devnum: cur.dev,
		p: usbPipe{dev: dev, in: fn.bulkIn, out: fn.bulkOut, outPacket: fn.outPacket}, mux: mux, pairDir: pairDir}
	setLinkNote("")
	setLinkTrust(false, "")
	return startRelay(kindIPhone, cur, dev, claimed, fr, mac, 0)
}

// iphoneWaitCarrier polls CARRIER_CHECK until the phone reports Personal
// Hotspot sharing, up to iphoneCarrierTries times. A phone that does not is
// used anyway: an untrusted phone, or one with the hotspot off, says so
// later.
func iphoneWaitCarrier(ctx context.Context, dev *usbDevice, iface uint16) bool {
	buf := make([]byte, 64)
	for i := 0; i < iphoneCarrierTries; i++ {
		if n, err := dev.control(0xc0, iphethCarrier, 0, iface, buf, 5000); err == nil && carrierOn(buf[:n]) {
			return true
		}
		if sleepCtx(ctx, iphoneCarrierWait) != nil {
			return false
		}
	}
	return false
}

func sysDevDir(sysName string) string          { return sysBusUSB + "/" + sysName }
func authorizedPath(info usbDeviceInfo) string { return sysDevDir(info.sysName) + "/authorized" }

// grabIPhone takes the device away from whatever holds it: deauthorize,
// reauthorize, then on the re-enumerated node select the hotspot
// configuration and claim the hotspot interface, racing the media daemon's
// attempts to put it back on configuration 2. It returns the open device,
// its re-enumerated info and function.
func grabIPhone(ctx context.Context, info usbDeviceInfo, fn netFunction, checkPreferred func() error) (*usbDevice, usbDeviceInfo, netFunction, error) {
	authPath := authorizedPath(info)
	for attempt := 0; attempt < iphoneGrabTries; attempt++ {
		if err := checkPreferred(); err != nil {
			return nil, info, fn, err
		}
		if err := ctx.Err(); err != nil {
			return nil, info, fn, err
		}
		if err := os.WriteFile(authPath, []byte("0\n"), 0644); err != nil {
			return nil, info, fn, fmt.Errorf("%s: deauthorize: %w", info, err)
		}
		cancelled := sleepCtx(ctx, iphoneDeauthHold) != nil
		// Reauthorize even when cancelled, so a stop during the hold never
		// leaves the device deauthorized (no media, CarPlay or data).
		if err := os.WriteFile(authPath, []byte("1\n"), 0644); err != nil {
			return nil, info, fn, fmt.Errorf("%s: reauthorize: %w", info, err)
		}
		if cancelled {
			return nil, info, fn, ctx.Err()
		}
		deadline := time.Now().Add(iphoneGrabWindow)
		for time.Now().Before(deadline) {
			if err := ctx.Err(); err != nil {
				return nil, info, fn, err
			}
			dev, cur, fn2, ok := claimHotspot(info.sysName, fn.config)
			if ok {
				logf("iPhone %s: took the device (configuration %d, hotspot interface %d)", cur, fn2.config, fn2.dataIface)
				return dev, cur, fn2, nil
			}
			sleepCtx(ctx, iphoneClaimRetry)
		}
	}
	return nil, info, fn, &busyError{fmt.Sprintf("%s: could not take the iPhone from the media service (it keeps reclaiming it)", info)}
}

// claimHotspot opens the re-enumerated device, selects config and claims its
// hotspot interface. ok is false while the device is still re-enumerating or
// the media daemon holds it; the caller retries.
func claimHotspot(sysName string, config int) (*usbDevice, usbDeviceInfo, netFunction, bool) {
	cur, ok := appleDevice(sysName)
	if !ok {
		time.Sleep(iphoneEnumPoll)
		return nil, usbDeviceInfo{}, netFunction{}, false
	}
	dev, err := openUSBDevice(cur.bus, cur.dev)
	if err != nil {
		return nil, usbDeviceInfo{}, netFunction{}, false
	}
	if err := dev.setConfiguration(config); err != nil {
		dev.Close()
		return nil, usbDeviceInfo{}, netFunction{}, false
	}
	time.Sleep(iphoneConfigSettle)
	cur, ok = appleDevice(sysName)
	if !ok {
		dev.Close()
		return nil, usbDeviceInfo{}, netFunction{}, false
	}
	fn, ok := cur.function(kindIPhone)
	if !ok || cur.config != config {
		dev.Close() // the media daemon put it back on its own configuration
		return nil, usbDeviceInfo{}, netFunction{}, false
	}
	if err := dev.claimInterface(fn.dataIface); err != nil {
		dev.Close()
		return nil, usbDeviceInfo{}, netFunction{}, false
	}
	return dev, cur, fn, true
}

// appleDevice re-reads the device at sysName, whose configuration changes
// as it is set up again.
func appleDevice(sysName string) (usbDeviceInfo, bool) {
	for _, info := range scanUSBDevices() {
		if info.sysName == sysName {
			return info, true
		}
	}
	return usbDeviceInfo{}, false
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// iphethFramer is the hotspot interface's framing.
type iphethFramer struct {
	dev      *usbDevice
	p        usbPipe
	iface    uint16
	ncm      bool
	authPath string
	sysName  string  // USB position
	devnum   int     // device number of this attachment
	mux      muxPipe // the usbmux interface, nil when it could not be claimed
	pairDir  string
	gotRx    int32 // a transfer has arrived, or the phone trusts the unit: carrier checks begin
	rxData   int32 // a transfer with data has arrived
	carrier  int32 // 0 unknown, 1 on, 2 off
}

func (f *iphethFramer) pipe() usbPipe { return f.p }

func (f *iphethFramer) rxSize() int { return iphethRx }

func (f *iphethFramer) send(frame []byte) error { return f.p.write(frame, false) }

func (f *iphethFramer) recv(buf []byte, emit func([]byte)) error {
	n, err := f.p.read(buf, iphethRxTimeout)
	if err != nil {
		return err
	}
	atomic.StoreInt32(&f.gotRx, 1)
	if n > 0 {
		atomic.StoreInt32(&f.rxData, 1)
	}
	if n == 0 || n == 4 && buf[0] == 0 && buf[1] == 1 {
		return nil
	}
	if f.ncm {
		iphethUnpackNCM(buf[:n], emit)
	} else {
		iphethUnpackLegacy(buf[:n], emit)
	}
	return nil
}

func iphethUnpackLegacy(b []byte, emit func([]byte)) {
	if len(b) > 2 {
		emit(b[2:])
	}
}

// iphethUnpackNCM reads the phone's NTB as IterioDev's tether does: the
// NDP16 right after the header, at most 22 entries, the list ended by a
// null entry or the end of the transfer; an empty entry, or one whose
// datagram does not fit the transfer, is skipped.
func iphethUnpackNCM(b []byte, emit func([]byte)) {
	le := binary.LittleEndian
	if len(b) < iphethNCMMin || le.Uint32(b) != nth16Sign || le.Uint16(b[10:]) != nth16Len ||
		le.Uint32(b[nth16Len:]) != ndp16NoCRC {
		return
	}
	for i := 0; i < iphethNDPMaxDPE; i++ {
		e := nth16Len + 8 + 4*i
		if e+4 > len(b) {
			return
		}
		idx, n := int(le.Uint16(b[e:])), int(le.Uint16(b[e+2:]))
		if idx == 0 && n == 0 {
			return
		}
		if n == 0 || idx+n > len(b) {
			continue
		}
		emit(b[idx : idx+n])
	}
}

// background gets the phone to trust the unit and polls the carrier once
// the phone trusts it (or sends anything).
func (f *iphethFramer) background(stop <-chan struct{}, fail func(error)) {
	trusted := make(chan struct{})
	if f.mux != nil {
		// The relay releases the interfaces once background returns, so the
		// pairing ends first.
		ctx, cancel := context.WithCancel(context.Background())
		ended := make(chan struct{})
		go func() {
			defer close(ended)
			f.trust(ctx, trusted, fail)
		}()
		defer func() {
			cancel()
			<-ended
		}()
	}
	t := time.NewTicker(iphethCarrierPoll)
	defer t.Stop()
	buf := make([]byte, 64)
	var trustedAt time.Time
	var stallWait time.Duration
	dataSeen := false
	for {
		select {
		case <-stop:
			return
		case <-trusted:
			atomic.StoreInt32(&f.gotRx, 1)
			trusted, trustedAt, stallWait = nil, time.Now(), iphoneStallWait(f.sysName, f.devnum)
			continue
		case <-t.C:
		}
		if atomic.LoadInt32(&f.gotRx) == 0 {
			continue
		}
		if !dataSeen && atomic.LoadInt32(&f.rxData) == 1 {
			dataSeen = true
			iphoneDataFlows(f.sysName, f.devnum)
		}
		if !trustedAt.IsZero() && !dataSeen && atomic.LoadInt32(&f.carrier) != 2 &&
			time.Since(trustedAt) > stallWait {
			iphoneFailed(f.sysName, f.devnum, false)
			fail(fmt.Errorf("the iPhone trusts the unit but sent nothing in %s; taking it again", stallWait))
			return
		}
		n, err := f.dev.control(0xc0, iphethCarrier, 0, f.iface, buf, 5000)
		if err != nil || n <= 0 {
			continue
		}
		on := carrierOn(buf[:n])
		state := int32(2)
		if on {
			state = 1
		}
		if atomic.SwapInt32(&f.carrier, state) != state {
			if on {
				logf("iPhone: Personal Hotspot carrier on")
				setLinkNote("")
			} else {
				logf("iPhone: Personal Hotspot carrier off")
				setLinkNote("Personal Hotspot is off")
			}
		}
	}
}

// trust sets usbmux up on the phone's usbmux interface (asked again while
// the phone does not answer) and gets the phone to trust the unit on that
// one usbmux session, retrying until it does or ctx ends; trusted is
// closed when it does. A declined Trust, or a usbmux session that ended,
// ends the link through fail, which hands the phone back to the media
// daemon; a declined phone is then left alone until it is plugged in
// again. trust is the only writer of the Trust note.
func (f *iphethFramer) trust(ctx context.Context, trusted chan<- struct{}, fail func(error)) {
	defer setLinkTrust(false, "")
	var m *usbMux
	for {
		var err error
		if m, err = openMux(f.mux); err == nil {
			break
		}
		if ctx.Err() != nil {
			return
		}
		logf("iPhone: %v; trying again in %s", err, iphoneTrustRetry)
		if sleepCtx(ctx, iphoneTrustRetry) != nil {
			return
		}
	}
	defer m.Close()
	defer context.AfterFunc(ctx, m.Close)() // a stop ends any request in flight
	err := iphoneTrustRetrying(ctx, m, f.pairDir, func(msg string) { setLinkTrust(msg != "", msg) }, iphoneTrustRetry)
	switch {
	case err == nil:
		logf("iPhone: trusted (lockdown session as the paired host)")
		close(trusted)
	case ctx.Err() != nil:
	case errors.Is(err, errTrustDenied):
		declineIPhone(f.sysName, f.devnum)
		fail(fmt.Errorf("%w; it goes back to media until it is plugged in again", err))
	default: // usbmux ended
		iphoneFailed(f.sysName, f.devnum, true)
		fail(err)
	}
}

// iphoneMemos is what the uplink remembers about the iPhone at each USB
// position for as long as that phone stays plugged in: whether its owner
// declined Trust, and how many times in a row its link failed (nothing
// received, usbmux ended), which spaces out the next takes. A memo is
// forgotten once the phone has left: its sysfs entry gone in a scan, or a
// new device number (a replug gives one; the authorized toggle keeps it).
var iphoneMemos = struct {
	sync.Mutex
	m map[string]*iphoneMemo
}{m: map[string]*iphoneMemo{}}

type iphoneMemo struct {
	devnum    int
	declined  bool
	fails     int       // failed links in a row
	notBefore time.Time // no take before this
}

// iphoneMemoFor returns the memo for this attachment, a fresh one when the
// phone at sysName has another device number. The caller holds the lock.
func iphoneMemoFor(sysName string, devnum int) *iphoneMemo {
	m := iphoneMemos.m[sysName]
	if m == nil || m.devnum != devnum {
		m = &iphoneMemo{devnum: devnum}
		iphoneMemos.m[sysName] = m
	}
	return m
}

// iphoneForgetGone drops the memos of phones no longer in devs.
func iphoneForgetGone(devs []usbDeviceInfo) {
	iphoneMemos.Lock()
	defer iphoneMemos.Unlock()
	for sys, m := range iphoneMemos.m {
		present := false
		for _, d := range devs {
			if d.sysName == sys && d.dev == m.devnum {
				present = true
			}
		}
		if !present {
			delete(iphoneMemos.m, sys)
		}
	}
}

func declineIPhone(sysName string, devnum int) {
	iphoneMemos.Lock()
	iphoneMemoFor(sysName, devnum).declined = true
	iphoneMemos.Unlock()
}

// iphoneHeldBack reports why the iPhone at info is not taken now: declined
// (its owner declined Trust), or wait (its last link failed and the backoff
// runs).
func iphoneHeldBack(info usbDeviceInfo) (declined, wait bool) {
	iphoneMemos.Lock()
	defer iphoneMemos.Unlock()
	m := iphoneMemos.m[info.sysName]
	if m == nil || m.devnum != info.dev {
		return false, false
	}
	return m.declined, time.Now().Before(m.notBefore)
}

// iphoneStallWait is how long a trusted phone may send nothing before it is
// taken again: iphoneStallAfter, doubled for each failed link in a row, up
// to iphoneStallMax. A link that ended for another reason waits as long
// before the phone is taken again.
func iphoneStallWait(sysName string, devnum int) time.Duration {
	iphoneMemos.Lock()
	defer iphoneMemos.Unlock()
	return stallWait(iphoneMemoFor(sysName, devnum).fails)
}

func stallWait(fails int) time.Duration {
	d := iphoneStallAfter
	for i := 0; i < fails && d < iphoneStallMax; i++ {
		d *= 2
	}
	return min(d, iphoneStallMax)
}

// iphoneFailed counts a failed link; with holdOff the phone is not taken
// again before the backoff has passed (a stalled link already waited it).
func iphoneFailed(sysName string, devnum int, holdOff bool) {
	iphoneMemos.Lock()
	defer iphoneMemos.Unlock()
	m := iphoneMemoFor(sysName, devnum)
	if holdOff {
		m.notBefore = time.Now().Add(stallWait(m.fails))
	}
	m.fails++
}

// iphoneDataFlows resets the backoff: the phone sends data.
func iphoneDataFlows(sysName string, devnum int) {
	iphoneMemos.Lock()
	defer iphoneMemos.Unlock()
	m := iphoneMemoFor(sysName, devnum)
	m.fails, m.notBefore = 0, time.Time{}
}

// halt reauthorizes the device on stop, so it re-enumerates at its default
// configuration and the media daemon reclaims it for media playback.
func (f *iphethFramer) halt() {
	if f.authPath == "" {
		return
	}
	if os.WriteFile(f.authPath, []byte("0\n"), 0644) == nil {
		time.Sleep(100 * time.Millisecond)
		os.WriteFile(f.authPath, []byte("1\n"), 0644)
	}
}

func carrierOn(r []byte) bool {
	return len(r) == 1 && r[0] == iphethCarrierOn || len(r) >= 2 && r[1] == iphethCarrierOn
}
