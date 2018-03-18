/**
 * generic-ssdp-http-json-adapter.js - HTTP+JSON web server adapter implemented as a plugin, with support for SSDP.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const fetch = require('node-fetch');

let Adapter, Device, Property;
try {
  Adapter = require('../adapter');
  Device = require('../device');
  Property = require('../property');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') {
    throw e;
  }

  const gwa = require('gateway-addon');
  Adapter = gwa.Adapter;
  Device = gwa.Device;
  Property = gwa.Property;
}

class GenericProperty extends Property {
  constructor(device, name, propertyDescription) {
    super(device, name, propertyDescription);
    this.unit = propertyDescription.unit;
    this.description = propertyDescription.description;
    this.href = propertyDescription.href;
    this.device = device;

    this.setCachedValue(propertyDescription.value);
    this.device.notifyPropertyChanged(this);
    let url = this.device.url + this.href;
    console.log('New GenericProperty, url='+url);
    
    fetch(url)
    .then((resp) => resp.json())
    .then((resp) => {
        let keys = Object.keys(resp);
        let values = Object.values(resp); 
        for (var i=0; i<keys.length; i++) {
          let obj = this.device.findProperty(keys[i]);
          obj.setCachedValue(values[i]);
          this.device.notifyPropertyChanged(obj);
        }
    });
  }

  /**
   * @method setValue
   * @returns a promise which resolves to the updated value.
   *
   * @note it is possible that the updated value doesn't match
   * the value passed in.
   */
  setValue(value) {
    return new Promise((resolve, reject) => {
      // set value but allow override in response.
      this.setCachedValue(value);
      resolve(value);
      this.device.notifyPropertyChanged(this);

    let url = this.device.url + this.href+'?'+this.name+'='+value;
    console.log('Getting '+url);
    fetch(url)
    .then((resp) => resp.json())
    .then((resp) => {
        let keys = Object.keys(resp);
        let values = Object.values(resp); 
        for (var i=0; i<keys.length; i++) {
console.log('Setting value for '+keys[i]+' to '+values[i]);
          let obj = this.device.findProperty(keys[i]);
          obj.setCachedValue(values[i]);
          this.device.notifyPropertyChanged(obj);
        }
    });

    });
  }
}

class GenericHTTPJSONDevice extends Device {
  constructor(adapter, id, name, type, description, url, properties) {
    super(adapter, id);

    this.url = url;
    this.name = name;
    this.type = type;
    this.description = description;

    console.log("Adding device at "+url);
    // properties are set by a json response from the actual device
    let keys = Object.keys(properties);
    let values = Object.values(properties);
    for (var i=0; i<keys.length; i++) {
      this.properties.set(keys[i], new GenericProperty(this, keys[i], values[i]));
    }
  }
}

class GenericSSDPAdapter extends Adapter {
  constructor(addonManager, packageName, manifest) {
    super(addonManager, 'GenericSSDPAdapter', packageName);
    addonManager.addAdapter(this);
    this.manifest = manifest;
  }

  async tryDevice(url, i) {
    console.log("Trying "+url);
    try {
      let response = await fetch(url);
      if (!response.ok) // or check for response.status
          throw new Error(response.statusText);
     let thingResponse = await response.json();
     let keys = Object.keys(thingResponse);
     let values = Object.values(thingResponse); 

     for( var n=0; n<keys.length; n++ ) {
        console.log('Adding thing->'+keys[n]);
        let thingObj = values[n];
        let name = thingObj['name'];
        let id = this.name + "-" + i + ':' + n;
        let description = '';
        if( thingObj['description'] )
          description = thingObj['description'];
        let type = thingObj['type'];
  
        this.handleDeviceAdded(new GenericHTTPJSONDevice(this, id, name, type, description, url, thingObj['properties']));
    }
    } catch(err) {
      //console.log('tryDevice err:+'+err);
    }
  }

  startPairing(timeoutSeconds) {
    console.log(this.name, 'id', this.id, 'pairing started, listening for SSDP NOTIFIY messages');
    console.log(this.name, 'id', this.id, 'timeoutSeconds='+timeoutSeconds);
    var PORT = 1900;
    var dgram = require('dgram');
    var client = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    var found = new Map();

    client.on('listening', function () {
      var address = client.address();
      client.setBroadcast(true)
      client.setMulticastTTL(128);
      client.addMembership('239.255.255.250');
    });

    client.on('message', function (message, remote) {
      //console.log('From: ' + remote.address + ':' + remote.port);
      lines = message.toString().split("\n");
      if (lines.length >= 2) {
        if (lines[0].match("^NOTIFY .*")) {
          for (var i = 1; i < lines.length; i++) {
            a = lines[i].split(": ");
            if (a.length == 2 && a[0] == "LOCATION") {
              location = a[1];
              if (found.has(location) == false) {
                console.log(this.name, 'id', this.id, "SSDP NOTIFY, LOCATION="+location);
                found.set(location, remote);
                this.tryDevice(url, i);
              }
            }
          }
        }
      }
    });

    client.bind(PORT);
  }
}

function loadGenericSSDPAdapter(addonManager, manifest, _errorCallback) {
  let adapter = new GenericSSDPAdapter(addonManager, manifest.name, manifest);
}

module.exports = loadGenericSSDPAdapter;
