// @ts-check
const path = require('path')
const fs = require('fs-extra')
const Promise = require('bluebird')
const colors = require('colors');
// const pRetry = require('@byungi/p-retry').pRetry
// const pDelay = require('@byungi/p-delay').pDelay
// const fileSize = require('./fileSize')

const { formatBytes } = require("./writeWaitingInfo");
const FileChecker = require('./fileChecker');
const { createLogger, isCompletelyDownloaded } = require('./fileChecker');

const ytdl = require('ytdl-run')
const youtubedl = require("youtube-dl-wrap")

const YTDlpWrap = require('yt-dlp-wrap').default;

const getFilesizeInBytes = filename => {
    return fs.existsSync(filename) ? fs.statSync(filename)["size"] : 0;
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
async function retry(fn, retriesLeft = 5, interval = 1000, exponential = false) {
    try {
        const val = await fn();
        return val;
    } catch (error) {
        if (retriesLeft) {
            console.log('.... p-cluster retrying left (' + retriesLeft + ')');
            console.log('retrying err', error);
            await new Promise(r => setTimeout(r, interval));
            return retry(fn, retriesLeft - 1, exponential ? interval*2 : interval, exponential);
        } else {
            console.log('Max retries reached');
            throw error
            //throw new Error('Max retries reached');
        }
    }
}

const download = (url, dest, localSizeInBytes, remoteSizeInBytes, downFolder, index = 0, ms) => {
    return new Promise(async (resolve, reject) => {
        const videoLogger = createLogger(downFolder);

        // await fs.remove(dest) // not supports overwrite..
        ms.update(dest, {
            text : `to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`,
            color: 'blue'
        });
        // console.log(`to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`)

        return await retry(async () => {//return
            const youtubeDlWrap = new youtubedl()
            let youtubeDlEventEmitter = youtubeDlWrap
                .exec([
                    url,
                    '--all-subs',
                    '--referer', 'https://serverforhackers.com/',
                    "-o", path.toNamespacedPath(dest),
                    '--socket-timeout', '5',
                ])
                .on("progress", (progress) => {
                    ms.update(dest, { text: `${index}. Downloading: ${progress.percent}% of ${progress.totalSize} at ${progress.currentSpeed} in ${progress.eta} | ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}` })
                })
                // .on("youtubeDlEvent", (eventType, eventData) => console.log(eventType, eventData))
                .on("error", (error) => {
                    // ms.remove(dest, { text: error })
                    console.log('error--', error)
                    console.log('error for url:', url);
                    ms.remove(dest);
                    /*fs.unlink(dest, (err) => {
                        reject(error);
                    });*/
                    reject(error);

                })
                .on("close", () => {
                    ms.succeed(dest, { text: `${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}` })//.split('/').pop()
                    // ms.remove(dest);
                    // console.log(`${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}`.green);
                    videoLogger.write(`${dest} Size:${getFilesizeInBytes(dest)}\n`);
                    resolve()
                })

        }, 6, 2e3, true)


    });
};

/* const downloadVideo = async (url, dest, {
    localSizeInBytes,
    remoteSizeInBytes,
    downFolder,
    index = 0,
    ms
}) => {
    try {
        await pRetry(
            () => download(url, dest,
                {
                    localSizeInBytes,
                    remoteSizeInBytes,
                    downFolder,
                    index,
                    ms
                }),
            {
                retries        : 3,
                onFailedAttempt: error => {
                    console.log(`Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left.`);
                    // 1st request => Attempt 1 failed. There are 4 retries left.
                    // 2nd request => Attempt 2 failed. There are 3 retries left.
                    // …
                }
            })
    } catch (e) {
        console.log('eeee', e);
        ms.remove(dest, { text: `Issue with downloading` });
    }
} */

const newDownload = (url, dest, localSizeInBytes, remoteSizeInBytes, downFolder, index = 0, ms) => {
    return new Promise(async (resolve, reject) => {
        // const videoLogger = createLogger(downFolder);
        // await fs.remove(dest) // not supports overwrite..
        ms.update(dest, {
            text : `to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`,
            color: 'blue'
        });
        // console.log(`to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`)

        return await retry(async () => {//return
            const ytDlpWrap = new YTDlpWrap();
            let ytDlpEventEmitter = ytDlpWrap
                .exec([
                    url,

                    "--write-subs",
                    "--write-auto-sub",

                    '--referer', 'https://serversforhackers.com/',
                    "-o", path.resolve(dest),
                    '--socket-timeout', '5'
                ])
                .on('ytDlpEvent', (eventType, eventData) =>
                    // console.log(eventType, eventData)
                    //65.0% of   24.60MiB at    6.14MiB/s ETA 00:01
                    ms.update(dest, { text: `${eventType}: ${eventData} | ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}` })
                )
                // .on("youtubeDlEvent", (eventType, eventData) => console.log(eventType, eventData))
                .on("error", (error) => {
                    ms.remove(dest, { text: error })
                    console.log('URL:', url, 'dest:', dest, 'error--', error)
                    //ms.remove(dest);
                    /*fs.unlink(dest, (err) => {
                        reject(error);
                    });*/
                    //return Promise.reject(error)
                    reject(error);

                })
                .on("close", () => {
                    ms.succeed(dest, { text: `${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}` })//.split('/').pop()
                    // ms.remove(dest);
                    // console.log(`${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}`.green);
                    // videoLogger.write(`${dest} Size:${getFilesizeInBytes(dest)}\n`);
                    FileChecker.writeWithOutSize(downFolder, dest)
                    resolve()
                })

        }, 6, 2e3, true)


    });
};

/**
 * @param file
 * @param {import("fs").PathLike} dest
 * @param downFolder
 * @param index
 * @param ms
 */
module.exports = async (file, dest, { downFolder, index, ms } = {}) => {
    const url = file.url;
    let remoteFileSize = file.size;
    ms.add(dest, { text: `Checking if video is downloaded: ${dest.split('/').pop()}` });
    // console.log(`Checking if video is downloaded: ${dest.split('/').pop()}`);

    let isDownloaded = false;
    let localSize = getFilesizeInBytes(`${dest}`)
    let localSizeInBytes = formatBytes(getFilesizeInBytes(`${dest}`))
    isDownloaded = isCompletelyDownloaded(downFolder, dest)

    if (remoteFileSize === localSize || isDownloaded) {
        ms.succeed(dest, { text: `${index}. Video already downloaded: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)}` });
        //ms.remove(dest);
        //console.log(`${index}. Video already downloaded: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)}`.blue);
        return;
    } else {
        ms.update(dest, { text: `${index} Start download video: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)} ` });
        // console.log(`${index} Start ytdl download: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)} `);
        return await newDownload(
            url,
            dest,
            localSizeInBytes,
            formatBytes(remoteFileSize), //remoteSizeInBytes: formatBytes(remoteFileSize),
            downFolder,
            index,
            ms
        );

    }
}

