# CarPlay multitouch changelog

## 0.1.0

- Two fingers on the touchscreen in CarPlay, from MareXcodemaster/idrive7-carplay-multitouch 0.1.0 (commit `a63052d`, its files unchanged). Installed for the next start of the head unit on the one CarPlay build it was made for (iDrive 7 `P18_23w44.2-1-3`); any other car is left unchanged. With the engine off (below 13.0 V) it installs by itself once the engine runs (tried every 30 s for 2 h). Uninstalling takes the patch out (mgu-deploy 0.6.4 `preUninstall`): the factory CarPlay from the next start.
