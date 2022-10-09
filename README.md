# Downloader and scraper for serversforhackers.com

[![npm](https://badgen.net/npm/v/sfhdown)](https://www.npmjs.com/package/sfhdown)
[![Hits](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Fmuhamed-didovic%2Fsfhdown&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=hits&edge_flat=false)](https://hits.seeyoufarm.com)
[![license](https://flat.badgen.net/github/license/muhamed-didovic/sfhdown)](https://github.com/muhamed-didovic/sfhdown/blob/master/LICENSE)

## Requirement (ensure that you have it installed)
- Node 18
- youtube-dl (https://github.com/ytdl-org/youtube-dl)

## Install
```sh
npm i -g sfhdown
```

#### without Install
```sh
npx sfhdown
```

## CLI
```sh
Usage
    $ sfhdown [CourseUrl]

Options
    --all, -a           Get all courses from particular school or provider.
    --email, -e         Your email.
    --password, -p      Your password.
    --directory, -d     Directory to save.
    --file, -f          Location of the file where are the courses
    --concurrency, -c

Examples
    $ sfhdown
    $ sfhdown -a
    $ sfhdown [url] [-d dirname] [-c number] [-f path-to-file]
```

## License
MIT
