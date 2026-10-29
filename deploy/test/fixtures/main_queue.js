"use strict";
// Stand-in for the app manager's main.js around its install queue: the
// fallback anchors as in main.js, makeMethodQueued's queue (one call at a
// time, in order) and AppManagementController's queued installs with its
// network-retry delay, each reduced to what the queue-first edit sees.
// The tests require the built copy and run installs through the controller.
// The queue module ends as MainApp's own utils/makeMethodQueued does.
const isMainapp=!0,mainAppSection="main_app";
class ProvisioningNotifier {
handle(section,newProvisioning){isMainapp&&section===mainAppSection&&(newProvisioning.installable_apps=newProvisioning.installable_apps||{app:[]});return newProvisioning}}
const makeMethodQueued_1=(function(){const logger={info:m=>(global.__fixtureLog=global.__fixtureLog||[]).push(m)},queueDataPerContext=new Map;
function makeMethodQueued(context,fn,catchErrors){return function(...args){const operationQueue=getQueueDataForContext(context).queue;let resolve;const queueItem={promise:new Promise(r=>{resolve=r}),fn:()=>Promise.resolve().then(()=>fn.apply(context,args)).catch(()=>{}).then(v=>resolve(v)).then(()=>{operationQueue.shift(),operationQueue[0]&&operationQueue[0].fn()})};return operationQueue.push(queueItem),1===operationQueue.length&&operationQueue[0].fn(),queueItem.promise}.bind(context)}
function getQueueDataForContext(context){let queueData=queueDataPerContext.get(context);return queueData||(queueData=Object.create({queue:[]}),queueDataPerContext.set(context,queueData)),queueData}
function getCurrentOperationPromise(context){const q=getQueueDataForContext(context).queue;return q[0]?q[0].promise:null}
const module={};function unqueueMethodCall(){}function onQueueIdle(){}function configureQueue(){}
module.exports={makeMethodQueued:makeMethodQueued,unqueueMethodCall:unqueueMethodCall,getCurrentOperationPromise:getCurrentOperationPromise,onQueueIdle:onQueueIdle,configureQueue:configureQueue};
return module.exports})({});
class AppManagementController{constructor(stub,delay){this.stub=stub,this.delay=delay,this.retries=0,this.queuedRecursiveRetry=makeMethodQueued_1.makeMethodQueued(this,this.queuedRecursiveRetry,!0)}
install(appId){this.clearBackOff&&this.clearBackOff();return new Promise((resolve,reject)=>{this.queuedRecursiveRetry(resolve,reject,{appId:appId,method:"install"})})}
queuedRecursiveRetry(resolve,reject,options){return this.awaitRetryDelay().then(()=>this.stub(options.appId)).then(()=>{this.retries=0,resolve()}).catch(()=>{this.retries++,void this.queuedRecursiveRetry(resolve,reject,options)})}
awaitRetryDelay(){if(0===this.retries)return Promise.resolve();const d=this.delay*Math.pow(2,this.retries-1);return new Promise(res=>{const cb=()=>{delete this.clearBackOff,res()},t=setTimeout(cb,d);this.clearBackOff=()=>{this.retries=0,clearTimeout(t),cb()}})}}
function start(appManager,appRegistry,logger){const mainApp={init:()=>Promise.resolve()};
return Promise.resolve().then(()=>{return mainApp.init()}).then(()=>{})}
module.exports=ProvisioningNotifier;module.exports.start=start;module.exports.AppManagementController=AppManagementController;
