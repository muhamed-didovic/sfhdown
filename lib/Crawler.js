const cheerio = require("cheerio")
const fs = require('fs-extra')
const sanitize = require('sanitize-filename')
const path = require('path')
const json2md = require('json2md')
const downOverYoutubeDL = require('./helpers/downOverYoutubeDL')
const imgs2pdf = require('./helpers/imgs2pdf')

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

const findChrome = require('chrome-finder')
const { orderBy, uniqBy } = require("lodash");
const { NodeHtmlMarkdown } = require('node-html-markdown')

const req = require('requestretry')
const retry = require("./helpers/retry");
const j = req.jar()
const request = req.defaults({
    jar         : j,
    retryDelay  : 500,
    fullResponse: true
})

module.exports = class Crawler {

    static async searchCourses(searchFromLocalFile) {
        if (searchFromLocalFile && await fs.exists(path.resolve(process.cwd(), 'json/search-courses.json'))) {
            console.log('LOAD FROM LOCAL SEARCH FILE');
            const courses = require(path.resolve(process.cwd(), 'json/search-courses.json'))
            return courses.map(c => ({
                ...c,
                value: c.url,
            }))
        }
        // return 'No courses found :('
        const lessons = await Promise
            .resolve()
            .then(async () => {
                const { body } = await request(`https://serversforhackers.com/`)
                // console.log('body', body);
                const $ = cheerio.load(body)

                return $('h2 a')//.elementor-grid article.sfwd-courses.type-sfwd-courses h3.elementor-heading-title a)
                    .map((i, elem) => {
                        // console.log('--', $(elem).text())
                        // console.log($(elem).attr('href'));
                        return {
                            title: $(elem).text(),
                            value: $(elem).attr('href')
                        }
                    })
                    .get();
            })
            .then(async topics => {
                // console.log('topics', topics);

                return await Promise.map(topics, async (t, index) => {
                    const { body } = await request(t.value)
                    const $ = cheerio.load(body)
                    return $('h3 a')
                        .map((i, elem) => {
                            // console.log('--', $(elem).text())
                            // console.log($(elem).attr('href'));
                            return {
                                title: $(elem).text(),
                                value: $(elem).attr('href'),
                                url  : $(elem).attr('href'),
                                topic: t
                            }
                        })
                        .get();
                });

            })
            .then(c => c.flat())
        await fs.ensureDir(path.resolve(process.cwd(), 'json'))
        await fs.writeFile(path.resolve(process.cwd(), 'json/search-courses.json'), JSON.stringify(lessons, null, 2), 'utf8')
        return lessons;
    }

    delay(time) {
        return new Promise(function (resolve) {
            setTimeout(resolve, time)
        })
    }

    /**
     *
     * @param fn
     * @returns {Promise<*>}
     */
    async withBrowser(fn) {
        const browser = await puppeteer.launch({
            headless         : true, //run false for dev memo
            Ignorehttpserrors: true, // ignore certificate error
            waitUntil        : 'networkidle2',
            defaultViewport  : {
                width : 1920,
                height: 1080
            },
            timeout          : 60e3,
            args             : [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '-- Disable XSS auditor', // close XSS auditor
                '--no-zygote',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '-- allow running secure content', // allow unsafe content
                '--disable-webgl',
                '--disable-popup-blocking',
                //'--proxy-server= http://127.0.0.1:8080 '// configure agent
            ],
            executablePath   : findChrome(),
        })

        try {
            return await fn(browser)
        } finally {
            await browser.close()
        }
    }

    /**
     *
     * @param browser
     * @returns {(function(*): Promise<*|undefined>)|*}
     */
    withPage(browser) {
        return async fn => {
            const page = await browser.newPage()
            try {
                return await fn(page)
            } finally {
                await page.close()
            }
        }
    }

    /**
     *
     * @param page
     * @param link
     * @param url
     * @returns {Promise<*>}
     */
    async getCoursesForDownload(page, link, { all }) {
        // console.log('--------', link, '-----');
        await page.goto('https://serversforhackers.com', { waitUntil: 'networkidle0', timeout: 100e3 })
        await page.waitForSelector('.open-overlay.hover-move')//, { timeout: 120e3 }
        await page.click('.open-overlay.hover-move')
        let specialCourses = [];
        if (await fs.exists(path.resolve(process.cwd(), 'json/search-courses.json'))) {//!all &&
            console.log('LOAD COURSE FROM LOCAL FILE');
            specialCourses = require(path.resolve(process.cwd(), 'json/search-courses.json'))
            const foundCourse = specialCourses.find(({ url }) => link.includes(url))
            if (foundCourse) {
                console.log('course is founded:', foundCourse.url);
                return [foundCourse]
            }
        }
        let series = [
            {
                "url": "https://serversforhackers.com/scaling-laravel/forge",
                "title": "Scaling on Forge",
                "topic": {
                    "title": "Special",
                    "value": ""
                }
            },
            {
                "url": "https://serversforhackers.com/dockerized-app/course",
                "title": "Dockerizing Your Application",
                "topic": {
                "title": "Special",
                "value": ""
            }
            },
            {
                "url": "https://serversforhackers.com/laravel-perf/course",
                "title": "Performant Laravel",
                "topic": {
                    "title": "Special",
                    "value": ""
                }
            }
        ]
        // let series = await page.evaluate(() => {
        //     return Array.from(document.querySelectorAll('ul.list-reset > li.pb-3 > a'), a => {
        //         return ({
        //             url  : a.href,
        //             title: a.innerText//a.querySelector('.course-listing-title')..innerText
        //         })
        //     })
        // })
        // console.log('1series', specialCourses.length);
        series = [...series, ...specialCourses]
        // series = uniqBy(series, 'url');
        // console.log('2series', series.length);
        return all ? series : ([series.find(({ url }) => link.includes(url)) ?? link])
        /*const link = links.find(link => url.includes(link.txt))
        if (!link) {
            throw 'No link of school found!!!'
        }
        */
    }

    async getLessons(browser, page, course, ms, opts) {
        // console.log('------course:', course);
        /*{
            title: 'Package Managers',
            value: 'https://serversforhackers.com/s/package-managers',
            url: 'https://serversforhackers.com/s/package-managers',
            topic: {
                title: 'Beginners',
                value: 'https://serversforhackers.com/t/beginners'
            }
        }*/
        // console.log('getting lessons for course:', course);
        // ms.update('info', { text: `Checking ${course.url} for ${lessons.flat().length} lessons` })
        await page.goto(`${course.url}`, { waitUntil: 'networkidle0' }) // wait until page load

        const lessons = await Promise.race([
            (async () => {
                try {
                    await page.waitForSelector('#footer > div.container > div:nth-child(1) > div:nth-child(1) > h3', { timeout: 12e3 })
                    let lessons = await page.evaluate(() => {
                        const series = Array.from(document.body.querySelectorAll('#footer > div.container > div:nth-child(1) > div:nth-child(1) > h3'), txt => txt.textContent)[0]
                        const links = Array.from(document.querySelectorAll('.container .row .video h3 a'), a => {
                            return ({
                                url  : a.href,
                                title: a.innerText
                                    .replaceAll('\\W+', '')
                                    .replace(/(\r\n|\n|\r)/gm, '')
                                    .replace(/[/\\?%*:|"<>]/g, '')
                                    .trim(),
                                series
                            })
                        })
                        return links
                    })
                    return lessons;
                } catch (e) {
                    return false;
                }

            })(),
            (async () => {
                try {
                    await page.waitForSelector('h2.value-prop', { timeout: 12e3 })
                    let lessons = await page.evaluate(() => {
                        const series = Array.from(document.body.querySelectorAll('h2.value-prop'), txt => txt.textContent)[0]
                        const links = Array.from(document.querySelectorAll('.video-card h3 a'), a => {
                            return ({
                                url  : a.href,
                                title: a.innerText
                                    .replaceAll('\\W+', '')
                                    .replace(/(\r\n|\n|\r)/gm, '')
                                    .replace(/[/\\?%*:|"<>]/g, '')
                                    .trim(),
                                series
                            })
                        })
                        return links
                    })
                    console.log('lessons.length:', lessons.length);//lessons
                    return lessons;
                } catch (e) {
                    return false;
                }

            })(),
            (async () => {
                try {
                    await page.waitForSelector('.px-4 > div.flex a', { timeout: 13e3 })
                    let lessons = await page.evaluate(() => {
                        const series = Array.from(document.body.querySelectorAll('header > h1'), txt => txt.textContent)[0]
                        const links = Array.from(document.body.querySelectorAll(".px-4 > div.flex a"), a => {
                            return ({
                                url  : a.href,
                                title: a.innerText
                                    .replaceAll('\\W+', '')
                                    .replace(/(\r\n|\n|\r)/gm, '')
                                    .replace(/[/\\?%*:|"<>]/g, '')
                                    .trim(),
                                series
                            })
                        })
                        return links
                    })
                    // console.log('2lessons.length', lessons, lessons.length);
                    return lessons;
                } catch (e) {
                    return false;
                }

            })(),
        ])

        // await this.makeScreenshot(browser, page, { title: course.title, topic: course.topic }, -1, course.title, opts)
        await Promise.all([
            this.makeScreenshot(browser, page, course, -1, course.title, opts),
            (async () => {
                //download videos
                // const prefix = all ? 'all-courses' : 'single-course'
                // const filename = `${prefix}-${new Date().toISOString()}.json`
                // await this.d(filename, prefix, items, { ms, ...opts });
                try {
                    await page.waitForSelector('#video-player iframe[src]', {
                        timeout: 10e3
                    })
                    // console.log('ima iframe:', lesson.url);
                    // Does exist
                } catch {
                    // console.log('nema iframe:', lesson.url);
                    return;
                }

                const vimeoUrl = await this.extractVimeoFromIframe(page);
                const items = [
                    {
                        series: course.title,
                        title: `00-${course.title}.mp4`,
                        position: 0,
                        downPath: path.join(course.topic.title, course.title),
                        vimeoUrl
                    }
                ]
                await this.d({ courses: items, ms, ...opts });
            })(),
        ])
        // if (!lessons.length) {
        //     console.log('no lessons!!!');
        // }

        return lessons

    }

    /**
     *
     * @param page
     * @param opts
     * @returns {Promise<void>}
     */
    async loginAndRedirect(page, opts) {
        const login = opts.login
        await page.goto(login, { waitUntil: 'networkidle0' })
        await page.focus('input[type="email"]')
        await page.keyboard.type(opts.email)
        await page.focus('input[type="password"]')
        await page.keyboard.type(opts.password)
        await page.click('input[type="submit"]')
        await this.delay(5e3)
    }

    /**
     * @param props
     * @param courses
     * @param dir
     * @param url
     * @returns {bluebird<void>}
     */
    async createMarkdown(courses, url, { dir, logger }) {
        //save resources into md
        courses = courses.filter(c => c?.markdown)
        const md = json2md([
            { h1: 'Links' },
            {
                link: [
                    ...(courses.length > 0 &&
                        [courses.map(c => ({
                            'title' : c.title,
                            'source': c.markdown
                        }))]
                    )
                ]
            }
        ])
        const course = courses[0]
        let downPath = sanitize(course.series)
        const dest = path.join(dir, downPath)
        await fs.ensureDir(dest)
        await fs.writeFile(path.join(dir, downPath, `Resources.md`), md, 'utf8')//-${Date.now()}
        logger.info(`Markdown created ...`)
    }

    /**
     *
     * @param opts
     * @param url
     * @returns {Promise<*>}
     */
    async scrapeCourses(opts, url) {
        const { ms, all, dir, concurrency } = opts
        ms.add('info', { text: `Get course: ${url}` })
        // let c = 0;
        return await this.withBrowser(async (browser) => {
            return await this.withPage(browser)(async (page) => {
                // await this.loginAndRedirect(page, opts)
                const courses = await this.getCoursesForDownload(page, url, opts)
                console.log('Number of courses to be downloaded:', courses.length);//, courses
                if (!courses?.length) {
                    console.log('No courses found, check if it is already downloaded!!!!');
                    return [];
                }

                const lessons = await Promise
                    .mapSeries(courses, async (course) => {
                        // ms.update('info', { text: `Checking ${course.url} for lessons` })

                        let lessons = await this.getLessons(browser, page, course, ms, opts);

                        if (!lessons?.length) {
                            console.log(`No lessons found for url: ${course.url}!!!!`);
                            return [];
                        }

                        return await Promise
                            .map(lessons, async (lesson, index) => {
                                return await this.withPage(browser)(async (page) => {
                                    return await this.retry(async () => {
                                        // console.log(`scraping: ${index} - ${lesson.url} - ${lesson.title}`);
                                        ms.update('info', { text: `scraping: ${index} - ${course.url} - ${course.title}, Lesson: ${lesson.url} - ${lesson.title}` })
                                        await page.goto(lesson.url, { waitUntil: 'networkidle0' })

                                        const result = await Promise.race([
                                            (async () => {
                                                try {
                                                    await page.waitForSelector('header > h1')
                                                    return 'first type of courses';
                                                } catch (e) {
                                                    return false;
                                                }

                                            })(),
                                            (async () => {
                                                try {
                                                    await page.waitForSelector('#course_header > div > div > div > h1')
                                                    return 'second type of courses';
                                                } catch (e) {
                                                    return false;
                                                }
                                            })(),
                                            (async () => {
                                                try {
                                                    await page.waitForSelector('h1.pb-4.font-normal.text-4xl')
                                                    return 'course page';
                                                } catch (e) {
                                                    return false;
                                                }
                                            })(),
                                        ])
                                        // console.log('resutl', result, lesson.url);


                                        await this.makeScreenshot(browser, page, course, index, lesson.title, opts)
                                        const vimeoUrl = await this.extractVimeoFromIframe(page);
                                        // console.log('vimeoUrl: ', vimeoUrl)
                                        const l = this.extractVideos({
                                            course: {
                                                topic: course.topic,
                                                index,
                                                vimeoUrl,
                                                ...lesson,
                                            },
                                            ms,
                                            index,
                                            total : lessons.length
                                        })

                                        // const prefix = all ? 'all-lessons' : 'single-course'
                                        // const filename = `${prefix}-${new Date().toISOString().replace(/:/g, "-")}.json`
                                        //await this.d({ courses: [l], ms, ...opts });
                                        //c++;
                                        return l;
                                    })

                                }, 6, 1e3, true);
                            }, { concurrency })
                            /*.then(async c => {
                                console.log('saving images to pdf', path.join(dir, c[0].downPath, 'screenshots'));
                                let dest = path.join(dir, c[0].downPath, 'screenshots')
                                await fs.ensureDir(dest)
                                await imgs2pdf(
                                    path.join(dest),
                                    path.join(dest, `${c[0].series}.pdf`)
                                )
                                return c;
                            })*/



                    })
                    /*.then(async c => c.flat())
                    .filter(Boolean)
                    .filter(item => item?.vimeoUrl)*/
                    .then(c => c.flat()
                        .filter(Boolean)
                        .filter(item => item?.vimeoUrl)
                    )
                    .then(async items => {
                        ms.update('info', { text: `---- ${items[0].series} has ${items.length} lessons for download` })
                        await Promise.all([
                            (async () => {
                                //check what is scraped from pages
                                await fs.ensureDir(path.resolve(process.cwd(), 'json'))
                                await fs.writeFile(path.resolve(process.cwd(), `json/test-${new Date().toISOString()}.json`), JSON.stringify(items, null, 2), 'utf8')
                            })(),
                            (async () => {
                                //download videos
                                // const prefix = all ? 'all-courses' : 'single-course'
                                // const filename = `${prefix}-${new Date().toISOString()}.json`
                                // await this.d(filename, prefix, items, { ms, ...opts });
                                await this.d({ courses: items, ms, ...opts });
                            })(),
                            (async () => {
                                // await imgs2pdf(
                                //     path.join(opts.dir, course.title),
                                //     path.join(opts.dir, course.title, `${course.title}.pdf`))
                                console.log('saving images to pdf', path.join(dir, items[0].downPath, 'screenshots'));
                                let dest = path.join(dir, items[0].downPath, 'screenshots')
                                await fs.ensureDir(dest)
                                await imgs2pdf(
                                    path.join(dest),
                                    path.join(dest, `${items[0].series}.pdf`)
                                )
                            })(),
                        ])

                        return items;
                    })


                ms.succeed('info', { text: `Found: ${lessons.length} lessons` })
                await fs.ensureDir(path.resolve(process.cwd(), 'json'))
                await fs.writeFile(path.resolve(process.cwd(), 'json/test.json'), JSON.stringify(lessons, null, 2), 'utf8')

                return lessons
            })
        })
    }

    async extractVimeoFromIframe(page) {
        const vimeoUrl = await retry(async () => {
            //wait for an iframe
            await page.waitForSelector('#video-player iframe[src]', {
                waitUntil: 'networkidle0',
                timeout  : 32e3
            })

            // const pageSrc = await browser.newPage()
            // page.setExtraHTTPHeaders({ referer: "https://serversforhackers.com/" })
            const iframeSrc = await page.evaluate(
                () => Array.from(document.body.querySelectorAll('#video-player iframe[src]'), ({ src }) => src)
            );

            if (iframeSrc[0].includes('www.youtube.com')) {
                console.log('-----we have youtube link', iframeSrc[0]);
                return iframeSrc[0]
            }
            const selectedVideo = await this.vimeoRequest(iframeSrc[0])
            return selectedVideo.url;
        }, 6, 1e3, true);
        return vimeoUrl;
    }

    /**
     *
     * @param browser
     * @param page
     * @param course
     * @param index
     * @param title
     * @param opts
     * @returns {Promise<void>}
     */
    async makeScreenshot(browser, page, course, index, title, opts) {
        //create a screenshot
        const $sec = await page.$('body')
        if (!$sec) throw new Error(`Parsing failed!`)
        await this.delay(1e3) //5e3

        title = sanitize(title)
        let series = sanitize(course.title)
        let topic = sanitize(course.topic.title)
        let position = index + 1

        const dest = path.join(opts.dir, topic, series)
        fs.ensureDir(path.join(dest, 'screenshots'));
        await $sec.screenshot({
            path          : path.join(dest, 'screenshots', `${String(position).padStart(2, '0')}-${title}.png`),
            type          : 'png',
            omitBackground: true,
            delay         : '500ms'
        })

        await this.delay(1e3)
        await this.createHtmlPage(page, dest, position, title);
        await this.createMarkdownFromHtml(page, dest, course, index, title);
        await this.createPdf(browser, page, dest, position, title);
        // await this.createFullPageScreenshot(page, dest, position, title);
        await this.delay(1e3)
    }

    /**
     *
     * @param opts
     * @returns {Promise<void>}
     */
    async d(opts) {
        const {
                  courses,
                  logger,
                  concurrency,
                  file,
                  filePath,
                  ms
              } = opts

        // let cnt = 0
        //logger.info(`Starting download with concurrency: ${concurrency} ...`)
        await Promise.map(courses, async (course, index) => {
            if (course.done) {
                console.log('DONE for:', course.title)
                cnt++
                return
            }
            /*if (!course.vimeoUrl) {
                throw new Error('Vimeo URL is not found')
            }*/

            if (!course?.downPath) {
                console.log('dest:', opts.dir, course.downPath)
                console.log('cccccc', course)
            }
            const dest = path.join(opts.dir, course.downPath)
            fs.ensureDir(dest)

            const details = await this.getSizeOfVideo(course)
            await downOverYoutubeDL(details, path.join(dest, course.title), {
                downFolder: dest,
                index,
                ms
            })

            if (file) {
                courses[index].done = true
                await fs.writeFile(filePath, JSON.stringify(courses, null, 2), 'utf8')
            }
            // cnt++
        }, {
            concurrency//: 1
        })
        //ms.stopAll('succeed');
        //logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${cnt})`)
    }

    /**
     *
     * @param file
     * @param logger
     * @param prefix
     * @param courses
     * @param filename
     * @returns {Promise<void>}
     */
    async writeVideosIntoFile(file, logger, prefix, courses, filename) {
        if (!file) {
            await fs.writeFile(path.join(process.cwd(), `json/${filename}`), JSON.stringify(courses, null, 2), 'utf8')
            logger.info(`json file created with lessons ...`)
        }
        logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${courses.length})`)
        //return courses
    }

    /**
     *
     * @param url
     * @returns {Promise<{size: string | undefined, url: *}>}
     */
    async vimeoRequest(url) {
        try {
            const { body, attempts } = await request({
                url,
                maxAttempts: 50,
                headers    : {
                    'Referer'   : "https://serversforhackers.com/",
                    'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/27.0.1453.110 Safari/537.36'
                }
            })

            const v = this.findVideoUrl(body, url)
            // console.log('attempts', attempts);
            const { headers, attempts: a } = await request({
                url         : v,
                json        : true,
                maxAttempts : 50,
                method      : "HEAD",
                fullResponse: true, // (default) To resolve the promise with the full response or just the body
                headers   : {
                    'Referer': "https://serversforhackers.com/"
                }
            })

            return {
                url : v,//url
                size: headers['content-length']
            };
        } catch (err) {
            console.log('ERR::', err);
            console.log('err url:', url);
            /*if (err.message === 'Received invalid status code: 404') {
                return Promise.resolve();
            }*/
            throw err;
        }
    }

    /**
     *
     * @param str
     * @param url
     * @returns {null|*}
     */
    findVideoUrl(str, url) {
        const regex = /(?:\bconfig|window\.playerConfig)\s*=\s*({.+?};?\s*var)/ // /playerConfig = {(.*)}; var/gm
        let res = regex.exec(str);
        let configParsed;
        if (res !== null && typeof res[0] !== "undefined") {
            try {
                // console.log('res', res[1]);
                configParsed = res[1]
                    .trim()
                    .replace(/(\r\n|\n|\r)/gm, "")
                    // .replace('var', '')
                    .replace(/(;?\s*var)/g, '')
                    .trim()
                    .replace(/(;\s*$)/g, "");
                // configParsed = configParsed.replace(/(; var\s*$)/g, '');
                // configParsed = configParsed.replace(/(;\s*$)/g, '');
                // console.log('---', configParsed);
                configParsed = JSON.parse(`${configParsed}`);
                let progressive = configParsed.request.files.progressive;

                if (!progressive.length) {
                    // console.log('Noooooooooooooooooooooooooooooooooooooooooooooooo', course.title, course.vimeoUrl);
                    return null;
                }

                // console.log('progressive', url, progressive);
                let video = orderBy(progressive, ['width'], ['desc'])[0];
                // console.log('video', video);
                return video.url;
            } catch (err) {
                console.log('error with findVideoUrl:', url, '-->err:', err);
                console.log('json config:', configParsed);
                console.log('res:', res[1]);
                // fs.writeFileSync(path.join('./json', `${url}.md`), str, 'utf8')//-${Date.now()}
                // fs.writeFileSync(path.join(process.cwd(), 'json', `${course.title}.md`), JSON.stringify(str, null, 2), 'utf8')
                // fs.writeFileSync(`./json/test.txt`, res, 'utf8')
                throw err;
            }
        }
        console.log('NO VIDEO FOUND:', url);
        // fs.writeFileSync(`./json/no-config-found-${Date.now()}.txt`, str, 'utf8')
        return null;
    }
    /**
     *
     * @param browser
     * @returns {Promise<boolean>}
     */
    async isHeadlessMode(browser) {
        // const u = await page.evaluate('navigator.userAgent');
        const ua = await browser.userAgent()
        // console.log('UA::', ua, ua.toLowerCase().includes('headlesschrome'))
        return ua.toLowerCase().includes('headlesschrome')
    }

    /**
     *
     * @param browser
     * @param page
     * @param dest
     * @param position
     * @param title
     * @returns {Promise<void>}
     */
    async createPdf(browser, page, dest, position, title) {
        if (!await this.isHeadlessMode(browser)) {
            console.log('headless mode is set off!!!')
            return
        }
        await fs.ensureDir(path.join(dest, 'pdf'))
        await page.pdf({
            path           : path.join(dest, 'pdf', sanitize(`${String(position).padStart(2, '0')}-${title}.pdf`)),
            printBackground: true,
            format         : "Letter"
        });
    }

    /**
     *
     * @param page
     * @param dest
     * @param position
     * @param title
     * @returns {Promise<void>}
     */
    async createHtmlPage(page, dest, position, title) {
        await fs.ensureDir(path.join(dest, 'html'))
        //save html of a page
        const html = await page.content();
        await fs.writeFile(path.join(dest, 'html', sanitize(`${String(position).padStart(2, '0')}-${title}.html`)), html);
        await this.delay(1e3)
    }

    /**
     *
     * @param page
     * @param dest
     * @param position
     * @param title
     * @returns {Promise<void>}
     */
    async createFullPageScreenshot(page, dest, position, title) {
        await fs.ensureDir(dest)
        await page.screenshot({
            path    : path.join(dest, sanitize(`${String(position).padStart(2, '0')}-${title}-full.png`)),
            fullPage: true
        });
    }

    /**
     *
     * @param page
     * @param dest
     * @param course
     * @param index
     * @param title
     * @returns {Promise<void>}
     */
    async createMarkdownFromHtml(page, dest, course, index, title) {
        const nhm = new NodeHtmlMarkdown();
        let position = index + 1
        const markdown = await Promise.race([
            (async () => {
                // check is 'first type course'
                try {
                    await page.waitForSelector('article.bg-white')
                    let markdown = await page.evaluate(() => Array.from(document.body.querySelectorAll("article.bg-white"), txt => txt.outerHTML)[0]);
                    return markdown;
                } catch (e) {
                    return false;
                }

            })(),
            (async () => {
                // check is 'second type course' or special courses like: https://serversforhackers.com/scaling-laravel
                try {
                    await page.waitForSelector('#video_description')
                    let markdown = await page.evaluate(() => Array.from(document.body.querySelectorAll("#video_description"), txt => txt.outerHTML)[0]);
                    return markdown;
                } catch (e) {
                    return false;
                }

            })(),//
            (async () => {
                // check is 'third type course'
                try {
                    await page.waitForSelector('.bg-white .container .border-b + .px-4')
                    let markdown = await page.evaluate(() => Array.from(document.body.querySelectorAll(".bg-white .container .border-b + .px-4"), txt => txt.outerHTML)[0]);
                    return markdown;
                } catch (e) {
                    return false;
                }

            })()
        ])
        // console.log('markdown', markdown);

        if (!markdown) {
            console.log('-----------------nema markdown', title, '-->', course.url);
            await this.createFullPageScreenshot(page, path.join(dest, sanitize(course.title), 'error'), 0, title);
            // throw new Error(`No Markdown found - ${title}`)
            return;
        }
        await fs.ensureDir(path.join(dest, 'markdown'))
        await fs.writeFile(path.join(dest, 'markdown', sanitize(`${String(position).padStart(2, '0')}-${title}.md`)), nhm.translate(markdown), 'utf8')
        await this.delay(1e3)
    }

    /**
     *
     * @param course
     * @param ms
     * @param index
     * @param total
     * @returns {bluebird<{series: string, downPath: string, position: number | string, title: string, url: string}>}
     */
    extractVideos({
        course,
        ms,
        index,
        total
    }) {
        let series = sanitize(course.series)
        let topic = sanitize(course.topic.title)
        let position = course.index + 1
        let title = sanitize(`${String(position).padStart(2, '0')}-${course.title}.mp4`)
        // let downPath = `${course.series.id}-${series}`
        let downPath = path.join(topic, series)
        // ms.update('info', { text: `Extracting: ${index}/${total} series ${series} - episode ${title}` });

        return {
            series,
            title,
            position,
            downPath,
            vimeoUrl: course.vimeoUrl,
            markdown: course.markdown,
            topic: course.topic
        }
    }

    /**
     *
     * @param course
     * @returns <string> url
     * @private
     */
    async getSizeOfVideo(course) {
        const vimeoUrl = course.vimeoUrl

        try {
            const {
                      headers,
                      attempts: a
                  } = await request({
                url         : vimeoUrl, //v,
                json        : true,
                maxAttempts : 50,
                method      : 'HEAD',
                fullResponse: true, // (default) To resolve the promise with the full response or just the body
            })

            return {
                url : vimeoUrl, //v
                size: headers['content-length']
            }
        } catch (err) {
            console.log('ERR::', err)
            /*if (err.message === 'Received invalid status code: 404') {
                return Promise.resolve();
            }*/
            throw err
        }
    };

    /**
     * Retries the given function until it succeeds given a number of retries and an interval between them. They are set
     * by default to retry 5 times with 1sec in between. There's also a flag to make the cooldown time exponential
     * @author Daniel Iñigo <danielinigobanos@gmail.com>
     * @param {Function} fn - Returns a promise
     * @param {Number} retriesLeft - Number of retries. If -1 will keep retrying
     * @param {Number} interval - Millis between retries. If exponential set to true will be doubled each retry
     * @param {Boolean} exponential - Flag for exponential back-off mode
     * @return {Promise<*>}
     */
    async retry(fn, retriesLeft = 5, interval = 1000, exponential = false) {
        try {
            const val = await fn()
            return val
        } catch (error) {
            if (retriesLeft) {
                console.log('.... retrying left (' + retriesLeft + ')')
                console.log('retrying err', error)
                await new Promise(r => setTimeout(r, interval))
                return this.retry(fn, retriesLeft - 1, exponential ? interval*2 : interval, exponential)
            } else {
                console.log('Max retries reached')
                throw error
                //throw new Error('Max retries reached');
            }
        }
    }
}

