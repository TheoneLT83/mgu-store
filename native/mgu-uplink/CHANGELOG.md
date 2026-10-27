# mgu-uplink changelog

## 0.6.0

- iPhone: the unit pairs with the phone the way a computer does (usbmux and lockdown on the phone's usbmux interface). The first time, the phone asks "Trust This Computer?". After Trust and the passcode, the phone is paired and the pairing is kept in `/var/opt/mgu-uplink/pairing/`. Every later connection opens a lockdown session as the paired host, so the phone serves its Personal Hotspot without asking again. A phone that forgot the pairing is paired again.
- iPhone: the hotspot interface is brought up as IterioDev's ipheth-tether does it: alternate setting 1 before GET_MACADDR and ENABLE_NCM, up to 10 CARRIER_CHECK polls, and CLEAR_HALT on both bulk endpoints. Frames go out with no zero-length packet. Every receive uses a 64 KiB buffer and a 1 s timeout. An NCM block entry that does not fit the transfer is skipped instead of ending the block.
- iPhone: when a phone trusts the unit and shares its hotspot but sends nothing for 20 s, it is taken again, as if it had been unplugged and plugged back in.
- Any device: the uplink always takes whatever is plugged in (USB Ethernet adapter, LTE stick, Android phone, iPhone), in the existing order when there are several. `uplink = usb|usbecm|rndis|ncm|iphone` and `usb_device` in a unit's `mgu-uplink.local.conf` are ignored and logged at start. `uplink = netdev:<ifname>` still selects an existing interface.
