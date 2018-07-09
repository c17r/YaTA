import * as _ from 'lodash'
import jose from 'node-jose'

/**
 * Twitch various APIs.
 */
enum TwitchApi {
  Auth = 'https://id.twitch.tv',
  Badges = 'https://badges.twitch.tv/v1/badges',
  Helix = 'https://api.twitch.tv/helix',
  Kraken = 'https://api.twitch.tv/kraken',
  Tmi = 'https://tmi.twitch.tv',
}

/**
 * Twitch broadcast type.
 */
export enum BroadcastType {
  Archive = 'archive',
  Highlight = 'highlight',
  Upload = 'upload',
}

/**
 * RegExp used to identify whisper command (/w user message).
 */
const WhisperRegExp = /^\/w \S+ .+/

/**
 * Twitch class.
 */
export default class Twitch {
  /**
   * Sets the Twitch token and user id to use for authenticated calls.
   * @param id - The user id or null to invalidate.
   * @param token - The token or null to invalidate.
   */
  public static setAuthDetails(id: string | null, token: string | null = null) {
    Twitch.userId = id
    Twitch.token = token
  }

  /**
   * Returns the Twitch authentication URL.
   * @return The auth URL.
   */
  public static getAuthURL() {
    const { REACT_APP_TWITCH_CLIENT_ID, REACT_APP_TWITCH_REDIRECT_URI } = process.env

    const params = {
      client_id: REACT_APP_TWITCH_CLIENT_ID,
      redirect_uri: REACT_APP_TWITCH_REDIRECT_URI,
      response_type: 'token id_token',
      scope: 'openid chat_login user_read user_blocks_edit clips:edit',
    }

    return Twitch.getUrl(TwitchApi.Auth, '/authorize', params)
  }

  /**
   * Returns the auth response token.
   * @param hash - The URL hash to parse
   * @return The parsed tokens.
   */
  public static getAuthTokens(hash: string) {
    const params = new URLSearchParams(hash.substring(1))

    if (!params.has('access_token') || !params.has('id_token')) {
      throw new Error('Invalid auth response.')
    }

    return {
      access: params.get('access_token') as string,
      id: params.get('id_token') as string,
    }
  }

  /**
   * Validates an ID token.
   * @param  token - The ID token received during authentication.
   * @return The verified ID token.
   */
  public static async verifyIdToken(token: string) {
    const jwk = await Twitch.fetchJWK()

    const keystore = await jose.JWK.asKeyStore(jwk)

    const jws = await jose.JWS.createVerify(keystore).verify(token)

    const idToken = JSON.parse(jws.payload.toString()) as IdToken

    if (_.get(idToken, 'aud') !== process.env.REACT_APP_TWITCH_CLIENT_ID || _.get(idToken, 'iss') !== TwitchApi.Auth) {
      throw new Error('Unable to verify ID token.')
    }

    return idToken
  }

  /**
   * Sanitizes the name of a channel (remove the extra # at the beginning if present).
   * @param  channel - The channel name to sanitize.
   * @return The sanitized name.
   */
  public static sanitizeChannel(channel: string) {
    if (channel.charAt(0) === '#') {
      return channel.substr(1)
    }

    return channel
  }

  /**
   * Determines if a message is a whisper command (/w user message).
   * @return `true` if the value is a whisper.
   */
  public static isWhisperCommand(message: string) {
    return WhisperRegExp.test(message)
  }

  /**
   * Fetches Twitch badges.
   * @return The badges.
   */
  public static async fetchBadges(channelId: string): Promise<RawBadges> {
    const response = await Promise.all([
      (await Twitch.fetch(TwitchApi.Badges, '/global/display')).json(),
      (await Twitch.fetch(TwitchApi.Badges, `/channels/${channelId}/display`)).json(),
    ])

    return { ...response[0].badge_sets, ...response[1].badge_sets }
  }

  /**
   * Fetches details about a specific user.
   * @param  id - The user id.
   * @return The user details.
   */
  public static async fetchUser(id: string): Promise<RawUser> {
    const response = await Twitch.fetch(TwitchApi.Kraken, `/users/${id}`)

    return response.json()
  }

  /**
   * Fetches details about a channel.
   * @param  id - The channel id.
   * @return The channel details.
   */
  public static async fetchChannel(id: string): Promise<RawChannel> {
    const response = await Twitch.fetch(TwitchApi.Kraken, `/channels/${id}`)

    return response.json()
  }

  /**
   * Fetches details about a stream.
   * @param  id - The channel id.
   * @return The stream details.
   */
  public static async fetchStream(id: string): Promise<{ stream: RawStream | null }> {
    const response = await Twitch.fetch(TwitchApi.Kraken, `/streams/${id}`)

    return response.json()
  }

  /**
   * Fetches videos for a channel.
   * @param  id - The channel id.
   * @param  [limit=10] - Number of videos to return.
   * @param  [type=BroadcastType.Archive] - Type of videos to return.
   * @return The channel videos.
   */
  public static async fetchChannelVideos(id: string, limit = 10, type = BroadcastType.Archive): Promise<RawVideos> {
    const params = {
      broadcast_type: type,
      limit: limit.toString(),
    }

    const response = await Twitch.fetch(TwitchApi.Kraken, `/channels/${id}/videos`, params)

    return response.json()
  }

  /**
   * Creates a clip.
   * @param  id - The channel id.
   * @param  [withDelay=false] - Add a delay before capturing the clip.
   * @return The new clip details.
   */
  public static async createClip(id: string, withDelay = false): Promise<RawNewClips> {
    const params = {
      broadcaster_id: id,
      has_delay: withDelay.toString(),
    }

    const response = await Twitch.fetch(TwitchApi.Helix, '/clips', params, true, RequestMethod.Post)

    return response.json()
  }

  /**
   * Fetches cheermotes.
   * @return The cheermotes.
   */
  public static async fetchCheermotes(): Promise<{ actions: RawCheermote[] }> {
    const response = await Twitch.fetch(TwitchApi.Kraken, '/bits/actions')

    return response.json()
  }

  /**
   * Fetches details about a clip.
   * @param  slug - The clip slug.
   * @return The clip details.
   */
  public static async fetchClip(slug: string): Promise<RawClip> {
    const response = await Twitch.fetch(TwitchApi.Kraken, `/clips/${slug}`)

    return response.json()
  }

  /**
   * Fetches details about multiple clips.
   * @param  slug - The clip slugs.
   * @return The clips details.
   */
  public static async fetchClips(slugs: string[]): Promise<RawClip[]> {
    const requests = _.map(slugs, async (slug) => Twitch.fetchClip(slug))

    return Promise.all(requests)
  }

  /**
   * Fetches chatters of a specific channel.
   * @param  channel - The channel.
   * @return The chatter.
   */
  public static async fetchChatters(channel: string): Promise<RawChattersDetails> {
    const response = await fetch(
      `https://cors-anywhere.herokuapp.com/${Twitch.getUrl(TwitchApi.Tmi, `/group/user/${channel}/chatters`)}`
    )

    return response.json()
  }

  /**
   * Fetches all followed streams for the current authenticated user.
   * @return The follows.
   */
  public static async fetchAuthenticatedUserFollows(): Promise<RawFollows> {
    const params = {
      limit: '100',
      sortby: 'last_broadcast',
    }

    const response = await Twitch.fetch(TwitchApi.Kraken, `/users/${Twitch.userId}/follows/channels`, params, true)

    return response.json()
  }

  /**
   * Fetches all online followed streams for the current authenticated user.
   * @return The streams.
   */
  public static async fetchAuthenticatedUserStreams(): Promise<RawStreams> {
    const params = {
      limit: '100',
      stream_type: 'live',
    }

    const response = await Twitch.fetch(TwitchApi.Kraken, '/streams/followed', params, true)

    return response.json()
  }

  /**
   * Fetches details about the current authenticated user.
   * @return The user details.
   */
  public static async fetchAuthenticatedUser(): Promise<AuthenticatedUserDetails> {
    const response = await Twitch.fetch(TwitchApi.Kraken, '/user', undefined, true)

    return response.json()
  }

  /**
   * Blocks a user.
   * @param  userId - The user id of the current user.
   * @param  targetId - The user id of the user to block.
   */
  public static async blockUser(targetId: string): Promise<RawBlockerUser> {
    const response = await Twitch.fetch(
      TwitchApi.Kraken,
      `/users/${Twitch.userId}/blocks/${targetId}`,
      undefined,
      true,
      RequestMethod.Put
    )

    return response.json()
  }

  /**
   * Defines if an object is either a live stream or a followed channel.
   * @param  streamOrChannel - The stream or channel to identify.
   * @return `true` of the parameter is a live stream.
   */
  public static isStream(streamOrChannel: RawStream | RawChannel): streamOrChannel is RawStream {
    return !_.isNil(_.get(streamOrChannel, 'stream_type'))
  }

  private static token: string | null
  private static userId: string | null

  /**
   * Returns the URL for a request.
   * @param  api - The Twitch API to use.
   * @param  endpoint - The endpoint to fetch.
   * @param  searchParams - Additional search parameters.
   * @return The URL.
   */
  private static getUrl(api: TwitchApi, endpoint: string, searchParams: { [key: string]: string } = {}) {
    const url = new URL(`${api}${endpoint}`)

    _.forEach(searchParams, (value, key) => url.searchParams.set(key, value))

    return url.toString()
  }

  /**
   * Fetches an URL.
   * @param  api - The Twitch API to use.
   * @param  endpoint - The endpoint to fetch.
   * @param  searchParams - Additional search parameters.
   * @param  authenticated - Defines if the endpoint requires authentication or not.
   * @param  options - Additionals request options.
   * @return The response.
   */
  private static async fetch(
    api: TwitchApi,
    endpoint: string,
    searchParams: { [key: string]: string } = {},
    authenticated = false,
    method = RequestMethod.Get
  ) {
    const url = Twitch.getUrl(api, endpoint, searchParams)

    const headers = new Headers({
      Accept: 'application/vnd.twitchtv.v5+json',
      'Client-ID': process.env.REACT_APP_TWITCH_CLIENT_ID,
    })

    if (authenticated) {
      const authHeader = Twitch.getAuthHeader(api)

      _.forEach(authHeader, (value, name) => {
        headers.append(name, value)
      })
    }

    const request = new Request(url, { method, headers })

    const response = await fetch(request)

    if (response.status !== 200) {
      const json = await response.json()

      const { message } = JSON.parse(_.get(json, 'message'))

      throw new Error(message)
    }

    return response
  }

  /**
   * Fetches Twitch public JWK.
   * @return The JWK.
   */
  private static async fetchJWK() {
    const jwkReponse = await fetch(Twitch.getUrl(TwitchApi.Auth, '/oauth2/keys'))

    const jwk = await jwkReponse.json()

    return jwk as JsonWebKey
  }

  /**
   * Returns an auth header that can be used for authenticated request.
   * @param  api - The API to get an auth token for.
   * @return The header.
   */
  private static getAuthHeader(api: TwitchApi) {
    if (_.isNil(Twitch.token)) {
      throw new Error('Missing token for authenticated request.')
    }

    return { Authorization: `${api === TwitchApi.Helix ? 'Bearer' : 'OAuth'} ${Twitch.token}` }
  }
}

/**
 * ID token.
 */
export type IdToken = {
  aud: string
  azp: string
  exp: number
  iat: number
  iss: string
  preferred_username: string
  sub: string
}

/**
 * Twitch badges.
 */
export type RawBadges = {
  [key: string]: {
    versions: {
      [key: string]: RawBadge
    }
  }
}

/**
 * Twitch badge.
 */
export type RawBadge = {
  click_action: string
  click_url: string
  description: string
  image_url_1x: string
  image_url_2x: string
  image_url_4x: string
  title: string
}

/**
 * Twitch user details.
 */
export type RawUser = {
  bio: string | null
  created_at: string
  display_name: string
  logo: string
  name: string
  type: string
  updated_at: string
  _id: string
}

/**
 * Twitch channel details.
 */
export type RawChannel = {
  mature: boolean
  status: string | null
  broadcaster_language: string
  display_name: string
  game: string | null
  language: string
  _id: string
  name: string
  created_at: string
  updated_at: string
  partner: boolean
  logo: string
  video_banner: string | null
  profile_banner: string | null
  profile_banner_background_color: string | null
  url: string
  views: number
  followers: number
  broadcaster_type: string
  description: string
  private_video: boolean
  privacy_options_enabled: boolean
}

/**
 * Twitch authenticated user details.
 */
export interface AuthenticatedUserDetails extends RawUser {
  email: string
  email_verified: boolean
  partnered: boolean
  twitter_connected: boolean
}

/**
 * Twitch chatters details.
 */
type RawChattersDetails = {
  chatter_count: number
  chatters: RawChatters
}

/**
 * Twitch chatters.
 */
export type RawChatters = {
  admins: string[]
  global_mods: string[]
  moderators: string[]
  staff: string[]
  viewers: string[]
}

/**
 * Twitch clip.
 */
export type RawClip = {
  broadcast_id: string
  broadcaster: RawClipUser
  created_at: string
  curator: RawClipUser
  duration: number
  embed_html: string
  embed_url: string
  game: string
  language: string
  slug: string
  thumbnails: {
    medium: string
    small: string
    tiny: string
  }
  title: string
  tracking_id: string
  url: string
  views: number
  vod: {
    id: string
    offset: number
    preview_image_url: string
    url: string
  }
}

/**
 * Twitch clip user.
 */
type RawClipUser = {
  channel_url: string
  display_name: string
  id: string
  logo: string
  name: string
}

/**
 * Blocked user.
 */
type RawBlockerUser = {
  user: {
    _id: string
    bio: string | null
    created_at: string
    display_name: string
    logo: string | null
    name: string
    type: string
    updated_at: string
  }
}

/**
 * Twitch follows.
 */
export type RawFollows = {
  follows: Array<{ created_at: string; notifications: true; channel: RawChannel }>
  _total: number
}

/**
 * Twitch streams.
 */
export type RawStreams = {
  streams: RawStream[]
  _total: number
}

/**
 * Twitch stream.
 */
export type RawStream = {
  average_fps: number
  broadcast_platform: string
  channel: RawChannel
  community_id: string
  community_ids: string[]
  created_at: string
  delay: number
  game: number
  is_playlist: boolean
  preview: RawPreview
  stream_type: string
  video_height: number
  viewers: number
  _id: string
}

/**
 * Twitch Cheermote.
 */
export type RawCheermote = {
  background: string[]
  prefix: string
  priority: number
  scales: string[]
  tiers: RawCheermoteTier[]
  type: string
  updated_at: string
}

/**
 * Twitch Cheermote tier.
 */
type RawCheermoteTier = {
  can_cheer: boolean
  color: string
  id: string
  images: { [key in CheermoteImageBackground]: RawCheermoteImages }
  min_bits: number
}

/**
 * Twitch videos.
 */
export type RawVideos = {
  videos: RawVideo[]
  _total: number
}

export type RawVideo = {
  animated_preview_url: string
  broadcast_id: number
  broadcast_type: BroadcastType
  channel: RawChannel
  communities: string[]
  created_at: string
  description: string | null
  description_html: string | null
  game: string
  language: string
  length: number
  preview: RawPreview
  published_at: string
  recorded_at: string
  restriction: string
  status: string
  tag_list: string
  title: string
  url: string
  viewable: string
  viewable_at: string | null
  views: number
  _id: string
}

/**
 * Twitch preview.
 */
type RawPreview = {
  large: string
  medium: string
  small: string
  template: string
}

/**
 * Twitch new clip.
 */
type RawNewClips = {
  data: Array<{ edit_url: string; id: string }>
}

/**
 * Twitch Cheermote images.
 */
type RawCheermoteImages = { [key in CheermoteImageType]: RawCheermoteImage }

/**
 * Twitch Cheermote image.
 */
export type RawCheermoteImage = { [key in CheermoteImageScales]: string }

/**
 * Cheermotes related types.
 */
export type CheermoteImageBackground = 'dark' | 'light'
type CheermoteImageType = 'static' | 'animated'
type CheermoteImageScales = '1' | '1.5' | '2' | '3' | '4'

/**
 * Twitch API allowed method.
 */
enum RequestMethod {
  Get = 'GET',
  Post = 'POST',
  Put = 'PUT',
}
