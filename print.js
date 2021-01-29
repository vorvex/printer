const escpos = require('escpos');
const axios = require('axios');
const { exec } = require('child_process');
escpos.Network = require('escpos-network');
const nodeHtmlToImage = require('node-html-to-image');
const fs = require('fs').promises;
const { uid = null } = require('./uid.json');
let interval = null;

let restaurantId;

const server = 'https://api.gastronaut.ai/v02/printer';

const findPrinter = async () => {

    console.log(uid);

    if(!uid) return;

    let url = server + `/findPrinter/${uid}`;

    try {
      const { data = {} } = await axios.get(url);
      

    const { connection = 'eth0', findPrinter = false, excludePrinter = [], findWifi = false } = data;

    restaurantId = data.restaurantId;

    console.log(restaurantId);

    // @TODO FindWiFi node-wifi

    if(!findPrinter) return

    exec(
      `sudo arp-scan --retry=8 --ignoredups -I ${connection} --localnet`,
      (error, stdout, stderr) => {
        if (error) {
          console.log(`error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.log(`stderr: ${stderr}`);
          return;
        }
  
        let regex = /(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/gm;
  
        let arr = stdout
          .split('\n')
          .filter((line) => line.replace(/\s/gm, '').match(regex))
          .map((line) => line.match(regex)[0]);
  
        arr = arr.filter((p) => !excludePrinter.includes(p));
  
        function makeConnection(ip) {
          return new Promise((resolve, reject) => {
            const device = new escpos.Network(ip);
  
            escpos.Image.load(__dirname + '/logo.png', function (image) {
              device.open((error) => {
                if (error) {
                  return resolve(null);
                }
  
                const options = { encoding: 'GB18030', width: 16 };
  
                const printer = new escpos.Printer(device, options);
  
                printer
                  .text(ip)
                  .image(image)
                  .then(function () {
                    printer.cut();
                    printer.close();
                    resolve(ip);
                  })
                  .catch(function (err) {
                    reject(err);
                  });
              });
            });
          });
        }
  
        (async () => {
          let x = await Promise.allSettled(arr.map(makeConnection));
  
          let printerInNetwork = x.filter((i) => i.value);
  
          //console.log(printerInNetwork);
  
          // let url = server + `/v02/menues/takeAway/${restaurantId}/addPrinter`;
  
          // await axios.post(url, { printerInNetwork });
        })();
      }
    );
  } catch (error) {
    return;
  }  
};

function print(ip, imagePath) {
    return new Promise((resolve, reject) => {
      const device = new escpos.Network(ip);
  
      escpos.Image.load(imagePath, function (image) {
        device.open((error) => {
          if (error) {
            return resolve(null);
          }
  
          const options = { encoding: 'GB18030', width: 58 };
  
          const printer = new escpos.Printer(device, options);
  
          printer
            .image(image)
            .then(function () {
              printer.cut();
              printer.close();
              resolve('Success');
            })
            .catch(function (err) {
              reject(err);
            });
        });
      });
    });
}

async function printBon({id, html = '', ip = '', times = 1 }) {
    try {
  
      let output = __dirname + `/${id}.png`;
          
      await nodeHtmlToImage({
        output: `./${id}.png`,
        html,
        puppeteerArgs: {
          headless: true,
          executablePath: '/usr/bin/chromium-browser',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
      });
  
      let promises = Array.from(Array(times), () => print(ip, output));

      await Promise.all(promises);
  
      fs.unlinkSync(output);

      if(id.endsWith('-kitchen')) return;
  
      let url = server + `/updatePrintableItem/${restaurantId}/${id}`;
  
      await axios.post(url, { printed: true, status: 'success' });
  
      console.log('success');
    } catch (error) {
      console.error(error);
  
      let url =
        server + `/updatePrintableItem/${restaurantId}/${id}`;
  
      await axios.post(url, {
        printed: false,
        status: 'failed',
        errorMsg: error.message,
      });
    }
}

async function checkForPrintableItems() {
    
    try {
      if(restaurantId === undefined) {
        const { data } = await axios.get(server + `/findPrinter/${uid}`);
        restaurantId = data.restaurantId;
      }
      
      if(!restaurantId) {
        clearInterval(interval);
        throw new Error('Not connected');
      }

      let url = server + `/getPrintableItems/${restaurantId}`;
  
      const { data } = await axios.get(url);
  
      await Promise.all(data.map(printBon));
      //await Promise.all(data.map(printBonKitchen));
    } catch (error) {
      console.error(error.message);
    }
}

async function getId(){
    if(!uid) {
        let url = server + `/newPrinter`;
        
        try {
          const { data } = await axios.get(url);
          await fs.writeFile('uid.json', JSON.stringify({ uid: data.id }));
        } catch (error) {
          await fs.writeFile('uid.json', JSON.stringify({ uid: null }));
        }
        
    } 
}

async function awaitInternetConnection() {
  try {

    await axios.get('https://www.google.com');

    console.log('Connected');

    return true;
    
  } catch (error) {
    console.log('No Connection');
    return false;
  }
}

function waitFor(msec) {
  return new Promise(res => setTimeout(res, msec))
}

(async () => {

    let connected = false;
    let x = 0

    while (!connected && x < 20) {
      x++
      connected = await awaitInternetConnection();
      if(!connected) await waitFor(10000);
    }

    await getId();
    await findPrinter();

    interval = setInterval(() => {
      checkForPrintableItems();
    }, 15000);
})();

