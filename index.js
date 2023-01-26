const puppeteer = require('puppeteer');
require('dotenv').config()

const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_KEY });

const baseUrl = "https://bodo.innsynsportal.no/motekalender";
const ids = [];
const siteData = new Map();

/**
 * Scrapes the content ids for the meetings we want
 * @returns Promise<Array[string]>
 */
const getContentIds = async (page) => {
    await page.goto(baseUrl);
    await new Promise(r => setTimeout(r, 5000));
    console.log(`Arrived at ${baseUrl}`)

    //Make sure the yearly calendar is selected and that content is loaded
    const yearBtnSelector = '.fc-year-button';
    await page.waitForSelector(yearBtnSelector);
    await page.click(yearBtnSelector);
    console.log(`Clicked year button`);

    await new Promise(r => setTimeout(r, 5000));

    await page.waitForSelector('#year-calendar');
    await page.waitForSelector('.fc-content');

    //Get all the ids we want to monitor
    const results = await page.$eval('#year-calendar', e => {
        const tds = document.querySelectorAll('td[data-utvalg="BYST"], td[data-utvalg="FORM"], td[data-utvalg="UTVPM"]');
        let contentIds = [];
        tds.forEach(td => {
            const contents = td.querySelectorAll('.fc-content');
            contents.forEach(content => {
                contentIds.push(content.getAttribute('id'));
            })
        })

        return contentIds;
    })

    if (results.length > 0) return results;
    else throw new Error("Couldn't find any content identifiers");
};


const scrapeData = async (page, id) => {
    console.log(`Navigating to ${baseUrl}/motedag/${id}`);
    await page.goto(`${baseUrl}/motedag/${id}`);
    await new Promise(r => setTimeout(r, 5000));
    console.log(`Scraping ${id}`);

    await page.waitForSelector('#modalContent');

    await new Promise(r => setTimeout(r, 5000));

    const results = await page.$eval('.modal-content', e => {
        const patt = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi;
        return e.querySelector('#modalContent').outerHTML.replace(patt, '');
    })

    return results;
}

const checkId = async (page, id) => {
    let oldData = siteData.get(id);
    let newData = await scrapeData(page, id);

    if (oldData !== newData && oldData !== undefined) {
        console.log(`${id} has changed`);

        const header = await page.$eval('#modalContent', e => {
            return e.querySelector('t').textContent
        })
        
        //Send mail
        const html = `
            Ny oppdatering ${new Date().toUTCString()}
            <br>
            <a href="${baseUrl}/motedag/${id}">${baseUrl}/motedag/${id}</a>
            <br>
            <h1>Ny data:</h1>
            <div style="padding: 15px; background: #f4f4f4;">
                ${newData}
            </div>
            <br>
            <br>
            <h1>Gammel data:</h1>
            <div style="padding: 15px; background: #f4f4f4;">
                ${oldData}
            </div>
        `
        mg.messages.create('post.bodonu.no', {
            from: "[BOT] Innsynsportalen <bot@lynxpub.no>",
            to: [process.env.REDAKSJON_EMAIL, process.env.PELLE_EMAIL],
            subject: `Forandring i møteplanen: (${header ? `${header} ${id}` : id})`,
            text: html,
            html: html
        })
        .then(msg => console.log(msg)).catch(err => console.error(err));

    } else {
        if (!oldData) console.log(`${id} Scraped new data`);
        else console.log(`${id} matches`);
    }

    return oldData !== newData ? newData : null;
}


(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    ids.push(...await getContentIds(page));

    let currentId = ids[0];
    const watcher = setInterval(async () => {
        const newData = await checkId(page, currentId);
        if (newData) {
            siteData.set(currentId, newData);
        }

        if (ids.indexOf(currentId) === ids.length - 1) {
            currentId = ids[0];
        } else {
            currentId = ids[ids.indexOf(currentId) + 1];
        }
    }, 15000);


    const heartbeat = setInterval(async () => {
        mg.messages.create('post.bodonu.no', {
            from: "[BOT] Innsynsportalen <bot@lynxpub.no>",
            to: [process.env.PELLE_EMAIL],
            subject: `I am alive!`,
            text: "I am alive!",
            html: "I am alive!"
        })
        .then(msg => console.log(msg)).catch(err => console.error(err));
    }, 24 * 60 * 60 * 1000)

    mg.messages.create('post.bodonu.no', {
        from: "[BOT] Innsynsportalen <bot@lynxpub.no>",
        to: [process.env.PELLE_EMAIL],
        subject: `Reboot!`,
        text: "Reboot!",
        html: "Reboot!"
    })
    .then(msg => console.log(msg)).catch(err => console.error(err));

    //await browser.close();
})();