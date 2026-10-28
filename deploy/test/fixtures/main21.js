"use strict";
// Stand-in for MainApp-21's main.js (iDrive 8): each anchor once, around a
// provisioning handler reduced to what the fallback sees: a section and its
// parsed provisioning (undefined when provisioning has no such section).
// The tests require the built copy and call handle(), or start(): start-up
// reduced to MainApp's init, with its appManager and appRegistry on
// mainApp, and the logger.
class ProvisioningNotifier {constructor(){this.isMainapp=!0,this.mainappSection="main_app"}
handle(section,data){let newProvisioning=data;this.isMainapp&&section===this.mainappSection&&(newProvisioning.installable_apps=newProvisioning.installable_apps||{app:[]});return newProvisioning}}
function start(appManager,appRegistry,logger){const mainApp={appManager:appManager,appRegistry:appRegistry,init:()=>Promise.resolve()};
return Promise.resolve().then(()=>Promise.all([mainApp.init()])).then(()=>{})}
module.exports=ProvisioningNotifier;module.exports.start=start;
