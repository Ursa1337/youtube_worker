import { Injectable, Inject } from '@nestjs/common'
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices'
import axios, { AxiosRequestConfig } from 'axios'
import { SocksProxyAgent } from 'socks-proxy-agent'
import * as crypto from 'crypto'
import UserAgent from 'user-agents'
import { JSDOM } from 'jsdom'
import { FileType } from './worker.type'

/*
class Proxy {
  proxies: Array<string>
  limitPerProxy: number
  proxyActivity: {
    [key: string]: {
      useCount: number
    }
  }

  constructor(proxies: Array<string>, limitPerProxy: number) {
    this.proxies = proxies
    this.limitPerProxy = limitPerProxy
    this.proxyActivity = {}
  }

  useProxy() {
    for (let i of this.proxies) {
      if (this.proxyActivity[i].useCount < this.limitPerProxy) {
        !this.proxyActivity[i].useCount && (this.proxyActivity[i].useCount = 0)
        this.proxyActivity[i].useCount++
        return i
      }
    }
  }

  freeProxy(proxy: string) {
    this.proxyActivity[proxy].useCount--
  }

  async check(targetUrl: string) {
    let result = []
    const promise = this.proxies.map((proxy) => {
        const httpAgent = new SocksProxyAgent(proxy)
        return axios({
          url: targetUrl,
          method: 'GET',
          httpAgent: httpAgent,
          httpsAgent: httpAgent,
          timeout: 3000
        }).then((response) => {
          result.push(proxy)
        })
    })
    return Promise.all(promise).then(() => {
      return result
    })
  }
}
*/

class VideoMeta {
  buffer: Buffer
  offset: number
  position: number
  size: number
  targetType: number

  constructor(buffer: Buffer, offset: number, targetType: number) {
    this.buffer = buffer
    this.offset = offset
    this.position = 0
    this.targetType = targetType
    this.setTargetOffset()
  }

  checkOffset() {
    if (this.buffer.length - this.offset < 8) {
      return false
    }
    let size = this.buffer.readUInt32BE(this.offset)
    if (size < 8 || this.buffer.length - this.offset < size) {
      return false
    }
    for (size = 4; size < 8; size++) {
      let byte = this.buffer.readInt8(this.offset + size)
      if (byte < 0x30 || byte > 0x7A) {
        return false
      }
    }
    return true
  }

  skipByte(count: number) {
    this.position += count
  }

  setTargetOffset() {
    while(this.checkOffset()) {
      let size = this.buffer.readUint32BE(this.offset)
      let type = this.buffer.readUInt32BE(this.offset + 4)
      if (type === this.targetType) {
        this.size = size
        this.position += 8
        return {
          offset: this.offset,
          size: size,
          type: type,
          position: this.position
        }
      }
      this.offset += size
    }
  }

  getTargetSegment() {
    return this.buffer.subarray(this.offset, this.offset + this.size)
  }

  readValue(stopByte?: number) {
    if (stopByte) {
      var count = this.size
    }
    else {
      for (count = this.position; count < this.size && this.buffer.readInt8(this.offset + count) !== stopByte; count - this.position) {
        count++
      }
    }
    const start = this.offset + this.position
    const end = start + count - this.position
    this.position = Math.min(count, this.size)
    return Buffer.from(this.buffer).subarray(start, end)
  }
}

class YoutubeLive {
  proxy: string
  videoId: string
  timeBootstrap: number
  cpn: string // clientPlaybackNonce = 16 random char, not change in all session
  appConfig: object
  playerConfig: object
  userAgent: string
  videoTime: number
  requestParam: object
  timeRequest: number
  sequenceStep: Array<number>
  sequence: number
  videoMeta: object

  constructor(videoId: string, proxy?: string) {
    this.proxy = proxy
    this.videoId = videoId
    this.timeBootstrap = new Date().getTime()
    this.cpn = this.getRandomString(16)
    this.userAgent = new UserAgent().toString()
    this.videoTime = 0
    this.requestParam = {}
    this.timeRequest = 0
    this.sequenceStep = [10, 10, 10, 40]
    this.sequence = 0
  }

  getRandomString(length: number): string {
    let buffer = crypto.getRandomValues(new Uint8Array(length))
    for (var result = [], position = 0; position < length; position++) {
      result.push(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.charAt(buffer[position] & 63)
      )
    }
    return result.join('')
  }

  extractJSON(text: string) {
    let countBrackets = 0
    let result = ''
    for (let i = 0; i <= text.length; i++) {
      let symbol = text.charAt(i)
      if (i === 0 && symbol !== '{') {
        throw 'Text must begin with open bracket'
      }
      result += symbol
      if (symbol === '{') {
        countBrackets += 1
      }
      else if (symbol === '}') {
        countBrackets -= 1
        if (countBrackets === 0) {
          return result
        }
      }
    }
    throw 'Text not contains json format string'
  }

  getRandomInt(min: number, max: number) {
    const randomBuffer = new Uint32Array(1)

    crypto.getRandomValues(randomBuffer)

    let randomNumber = randomBuffer[0] / (0xffffffff + 1)

    min = Math.ceil(min)
    max = Math.floor(max)
    return Math.floor(randomNumber * (max - min + 1)) + min
  }

  async axiosHandle(config: AxiosRequestConfig<any>) {
    while (true) {
      try {
        if (this.proxy) {
          const httpAgent = new SocksProxyAgent(this.proxy)
          return await axios({
            ...config,
            httpAgent: httpAgent,
            httpsAgent: httpAgent
          })
        }
        return await axios(config)
      }
      catch (e) {
        //console.log(e)
      }
    }
  }

  async getConfig() {
    if (this.appConfig && this.playerConfig) {
      return [this.appConfig, this.playerConfig]
    }
    return await this.axiosHandle({
      method: 'GET',
      url: ['https://www.youtube.com/watch', this.videoId].join('?v='),
      headers: {
        'Accept-Language': 'en-US',
        'User-Agent': this.userAgent
      }
    }).then((response) => {
      const dom = new JSDOM(response.data)
      let elements = dom.window.document.getElementsByTagName('script')
      for (let element of elements) {
        try {
          if (
            element.innerHTML.includes('ytcfg.set(')
          ) {
            var appConfig = JSON.parse(
              this.extractJSON(
                element.innerHTML
                  .split('ytcfg.set(')[1]
              )
            )
          }
          if (
            element.innerHTML.includes('var ytInitialPlayerResponse = ')
          ) {
            var playerConfig = JSON.parse(
              this.extractJSON(
                element.innerHTML
                  .split('var ytInitialPlayerResponse = ')[1]
              )
            )
          }
        }
        catch (e) {

        }
      }
      if (!appConfig || !playerConfig) {
        console.log(this.proxy)
        throw 'Fail getting config with user agent ' + this.userAgent
      }
      if (appConfig && playerConfig) {
        return [this.appConfig, this.playerConfig] = [appConfig, playerConfig]
      }
    })
  }

  async getVideoMeta(url: string) {
    if (this.videoMeta) {
      return this.videoMeta
    }
    return await this.axiosHandle({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      headers: {
        'Accept-Language': 'en-US',
        'User-Agent': this.userAgent
      }
    }).then((response) => {
      let result = {}
      const metaData = new VideoMeta(response.data, 0, 0x656D7367)
      metaData.skipByte(4)
      metaData.readValue(0x00)
      metaData.skipByte(18)
      let params = metaData.readValue().toString().split('\r\n')
      for (let i = 0; i < params.length; i++) {
        if (!params[i].length) {
          return result
        }
        var kv = params[i].match(/([^:]+):\s+([\S\s]+)/)
        if (kv) {
          result[kv[1]] = kv[2]
        }
      }
    })
  }

  async watchtimeHandle() {
    let watchtimeParam = {}
    let videoUrl = ''
    const [appConfig, playerConfig] = await this.getConfig()
    const defaultParam = Object.fromEntries(
      new URLSearchParams(
        playerConfig
        .playbackTracking
        .videostatsPlaybackUrl
        .baseUrl
        .split('playback?')[1]
      )
    )

    defaultParam.ns && (watchtimeParam['ns'] = defaultParam.ns)
    defaultParam.el && (watchtimeParam['el'] = defaultParam.el)
    watchtimeParam['cpn'] = this.cpn
    watchtimeParam['ver'] = 2 //hardcoded
    watchtimeParam['euri'] = '' //Maybe hardcoded
    defaultParam.live && (watchtimeParam['live'] = defaultParam.live)
    defaultParam.cl && (watchtimeParam['cl'] = defaultParam.cl)
    watchtimeParam['state'] = 'playing' //TODO
    watchtimeParam['cplayer'] = 'UNIPLAYER' //hardcoded
    defaultParam.delay && (watchtimeParam['delay'] = defaultParam.delay)
    watchtimeParam['vis'] = '0' //TODO video view type (enum)
    defaultParam.docid && (watchtimeParam['docid'] = defaultParam.docid)
    defaultParam.ei && (watchtimeParam['ei'] = defaultParam.ei)
    defaultParam.plid && (watchtimeParam['plid'] = defaultParam.plid)
    defaultParam.referrer && (watchtimeParam['referrer'] = defaultParam.referrer)
    defaultParam.sourceid && (watchtimeParam['sourceid'] = defaultParam.sourceid)
    defaultParam.of && (watchtimeParam['of'] = defaultParam.of)
    defaultParam.vm && (watchtimeParam['vm'] = defaultParam.vm)

    appConfig
      ?.INNERTUBE_CONTEXT
      ?.client
      ?.browserName 
    && (
      watchtimeParam['cbr'] = appConfig
                                .INNERTUBE_CONTEXT
                                .client.browserName
    )

    appConfig
      ?.INNERTUBE_CONTEXT
      ?.client
      ?.browserVersion 
    && (
      watchtimeParam['cbrver'] = appConfig
                                  .INNERTUBE_CONTEXT
                                  .client
                                  .browserVersion
    )

    appConfig
      ?.INNERTUBE_CONTEXT
      ?.client
      ?.clientName 
    && (
      watchtimeParam['c'] = appConfig
                              .INNERTUBE_CONTEXT
                              .client
                              .clientName
    )

    appConfig
      ?.INNERTUBE_CONTEXT
      ?.client
      ?.clientVersion 
    && (
      watchtimeParam['cver'] = appConfig
                                .INNERTUBE_CONTEXT
                                .client
                                .clientVersion
    )

    appConfig
      ?.INNERTUBE_CONTEXT
      ?.client
      ?.osName 
    && (
      watchtimeParam['cos'] = appConfig
                                .INNERTUBE_CONTEXT
                                .client
                                .osName
    )

    appConfig
      ?.INNERTUBE_CONTEXT
      ?.client
      ?.osVersion 
    && (
      watchtimeParam['cosver'] = appConfig
                                  .INNERTUBE_CONTEXT
                                  .client
                                  .osVersion
    )

    appConfig
      ?.INNERTUBE_CONTEXT
      ?.client
      ?.platform 
    && (
      watchtimeParam['cplatform'] = appConfig
                                      .INNERTUBE_CONTEXT
                                      .client
                                      .platform
    )

    appConfig
      ?.WEB_PLAYER_CONTEXT_CONFIGS
      ?.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH
      ?.hl 
    && (
      watchtimeParam['hl'] = appConfig
                              .WEB_PLAYER_CONTEXT_CONFIGS
                              .WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH
                              .hl
    )

    appConfig
      ?.WEB_PLAYER_CONTEXT_CONFIGS
      ?.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH
      ?.contentRegion 
    && (
      watchtimeParam['cr'] = appConfig
                              .WEB_PLAYER_CONTEXT_CONFIGS
                              .WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH
                              .contentRegion
    )

    playerConfig
      ?.streamingData
      ?.adaptiveFormats 
    && (
      playerConfig.streamingData.adaptiveFormats.some((format: any) => {
        if (format.mimeType.includes('audio/')) {
          watchtimeParam['afmt'] = format.itag
          return true
        }
      })
    ) //Audio format
    
    playerConfig
      ?.streamingData
      ?.adaptiveFormats 
    && (
      playerConfig.streamingData.adaptiveFormats.some((format: any) => {
        if (format.mimeType.includes('video/')) {
          videoUrl = format.url
          watchtimeParam['fmt'] = format.itag
          return true
        }
      })
    ) //Video quality tag

    let videoMeta = await this.getVideoMeta(videoUrl)
    watchtimeParam['cmt'] = this.requestParam['cmt'] ? (
      +(this.requestParam['cmt'] + (new Date().getTime() - this.timeRequest) / 1E3).toFixed(3)
    ) : (
      videoMeta['Stream-Duration-Us'] && +(videoMeta['Stream-Duration-Us'] / 1E6).toFixed(3)
    ) //timstamp video

    this.requestParam['cmt'] && (
      watchtimeParam['st'] = this.requestParam['cmt']
    ) //begin segment

    this.requestParam['cmt'] && (
      watchtimeParam['et'] = watchtimeParam['cmt']
    ) //end segment

    watchtimeParam['lio'] = this.requestParam['lio'] ? (
      this.requestParam['lio']
    ) : (
      videoMeta['Ingestion-Walltime-Us'] && +(videoMeta['Ingestion-Walltime-Us'] / 1E6).toFixed(3)
    ) //Get from video meta 'Ingestion-Walltime-Us' /1E6

    watchtimeParam['idpj'] = this.requestParam['idpj'] ? (
      this.requestParam['idpj']
    ) : (
      -this.getRandomInt(0, 9) //Math.floor(10 * Math.random())
    )

    watchtimeParam['ldpj'] = this.requestParam['ldpj'] ? (
      this.requestParam['ldpj']
    ) : (
      -this.getRandomInt(0, 39) //Math.floor(40 * Math.random())
    )

    watchtimeParam['lact'] = (() => {
      if (this.requestParam['lact']) {
        return new Date().getTime() - this.timeRequest + this.requestParam['lact']
      }
      return this.getRandomInt(0, new Date().getTime() - this.timeBootstrap)
    })() //TODO last activity

    watchtimeParam['volume'] = (() => {
      if (this.requestParam['volume']) {
        return this.requestParam['volume']
      }
      return 100
    })() //TODO volume video range 0-100

    watchtimeParam['muted'] = (() => {
      if (this.requestParam['muted']) {
        return this.requestParam['muted']
      }
      return 0
    })() //TODO video is muted

    watchtimeParam['fs'] = (() => {
      if (this.requestParam['fs']) {
        return this.requestParam['fs']
      }
      return 0
    })() //TODO fullscreen video boolean 0-1

    watchtimeParam['rt'] = (() => {
      return (new Date().getTime() - this.timeBootstrap) / 1E3
    })()

    watchtimeParam['rti'] = (() => {
      return Math.floor((new Date().getTime() - this.timeBootstrap) / 1E3)
    })()

    watchtimeParam['rtn'] = (() => {
      let rtn = Math.floor((new Date().getTime() - this.timeBootstrap) / 1E3)
      rtn += this.getStepBySequence(watchtimeParam['idpj'], watchtimeParam['ldpj'])
      return rtn
    })()
    this.requestParam = watchtimeParam
    return watchtimeParam
  }

  getStepBySequence(idpj: number, ldpj: number) {
    let step = this.sequence < this.sequenceStep.length ? (
      this.sequenceStep[this.sequence]
    ) : (
      this.sequenceStep[this.sequenceStep.length - 1]
    ) // [10, 10, 10, 40]
    if (this.sequence === 0) {
      step += idpj // [10 - idpj, 10, 10, 40]
    }
    if (this.sequence === this.sequenceStep.length - 1) {
      step += ldpj // [10 - idpj, 10, 10, 40 - ldpj]
    }
    return step
  }

  async timeout(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async startWatchtime() {
    const [appConfig, playerConfig] = await this.getConfig()
    const headers = {
      'X-Goog-Visitor-Id': appConfig['VISITOR_DATA'],
      'User-Agent': this.userAgent
    }

    await this.axiosHandle({
      method: 'GET',
      url: 'https://www.youtube.com/api/stats/playback',
      params: await this.watchtimeHandle(),
      headers: headers
    })

    this.timeRequest = new Date().getTime()

    await this.axiosHandle({
      method: 'GET',
      url: 'https://www.youtube.com/api/stats/delayplay',
      params: await this.watchtimeHandle(),
      headers: headers
    })
    this.timeRequest = new Date().getTime()

    while (true) {
      const params = await this.watchtimeHandle()
      await this.axiosHandle({
        method: 'GET',
        url: 'https://www.youtube.com/api/stats/watchtime',
        params: await this.watchtimeHandle(),
        headers: headers
      })
      this.timeRequest = new Date().getTime()
      await this.timeout(
        this.getStepBySequence(params['idpj'], params['ldpj']) * 1000
      )
      this.sequence++
    }
  }
}

@Injectable()
export class WorkerService {
  constructor(
    @Inject('RABBITMQ_SERVICE') private client: ClientProxy
  ) {}

  async onApplicationBootstrap() {
    await this.client.connect()
  }

  async addToQueue(cmd: string, payload: any) {
    const record = new RmqRecordBuilder(payload).build()
    this.client.send({ cmd: cmd }, record).subscribe()
  }

  async getImage(url: string): Promise<FileType> {
    return axios.get(
      url,
      { responseType: 'arraybuffer' }  
    ).then((response) => {
      return {
        contentType: response.headers['content-type'],
        buffer: response.data
      }
    })
  }

  async retrievingVideo(userId: number, videoId: string) {
    axios.get(
      ['https://www.youtube.com/watch', videoId].join('?v='),
      {
        headers: {
          'Accept-Language': 'en-US'
        }
      }
    ).then(async (response) => {
      const dom = new JSDOM(response.data)
      let elements = dom.window.document.getElementsByTagName('script')
      for (let element of elements) {
        if (
          element.innerHTML && 
          element.innerHTML.includes('var ytInitialPlayerResponse = ')
        ) {
          let result = JSON.parse(
            element.innerHTML
              .split('var ytInitialPlayerResponse = ')[1]
              .split(';var meta')[0]
          )
          if (
            result && 
            result.playabilityStatus && 
            result.playabilityStatus.status === 'OK'
          ) {
            const payload = {
              userId: userId,
              videoId: videoId,
              author: result.videoDetails.author,
              channelId: result.videoDetails.channelId,
              title: result.videoDetails.title,
              isLive: result.videoDetails.isLiveContent,
              thumbnail: await this.getImage(result.videoDetails.thumbnail.thumbnails.slice(-1)[0].url)
            }
            this.addToQueue('updateVideo', payload)
          }
          else {
            this.addToQueue('rejectVideo', { userId: userId, videoId: videoId })
          }
        }
      }
    })
  }
}