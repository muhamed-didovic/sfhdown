const createLogger = require('./helpers/createLogger')
const Crawler = require('./Crawler')

const Bluebird = require('bluebird')
Bluebird.config({ longStackTraces: true })
global.Promise = Bluebird;

const Spinnies = require('dreidels')
const ms = new Spinnies()

exports.scrape = async (opts = {}) => {
    const url = opts.courseUrl;

    opts = normalizeOpts(opts)
    console.log('opts', opts);
    const { logger, file, filePath, all } = opts

    let crawler = new Crawler()
    const courses = file ? require(filePath) : await crawler.scrapeCourses({ms, ...opts}, url)
    console.log('found lessons: ', courses.length);

    // return;

    const prefix = all ? 'all-courses' : 'single-course'
    const filename = `${prefix}-${new Date().toISOString()}.json`
    await crawler.d(filename, prefix, courses, {ms, ...opts});
    // await crawler.createMarkdown(courses, url, opts);
    await crawler.writeVideosIntoFile(file, logger, prefix, courses, filename)
}

function normalizeOpts(opts) {
    if (!opts.dir) opts.dir = process.cwd()
    if (!opts.logger) opts.logger = require('./helpers/nullLogger')
    if (!opts.logger.isLogger) opts.logger = createLogger(opts.logger)
    if (!opts.concurrency) opts.concurrency = 10
    return opts
}
