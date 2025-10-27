import cfonts from 'cfonts';
import blessed from 'blessed';
import axios from 'axios';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MembitNode {
  constructor(account, proxy = null, id) {
    this.account = account;
    this.proxy = proxy;
    this.id = id;
    this.userInfo = {};
    this.totalPoints = 0;
    this.estimatedEpochPoints = 0;
    this.eligiblePostsCount = 0;
    this.epochId = 0;
    this.nextEpochCountdown = '00:00';
    this.nextScrollCountdown = '30:00';
    this.status = 'Idle';
    this.nextEpochTime = null;
    this.nextScrollTime = null;
    this.fetchInterval = null;
    this.countdownInterval = null;
    this.scrollInterval = null;
    this.uiScreen = null;
    this.accountPane = null;
    this.logPane = null;
    this.isDisplayed = false;
    this.logs = [];
    this.ipAddress = 'N/A';
    this.seenTweetIds = [];
    this.isScrolling = false;
    this.submittedUrls = new Set();
  }

  async start() {
    await this.fetchIpAddress();
    await this.fetchUserInfo();
    this.startPeriodicFetch();
    this.startAutoScroll();
  }

  async fetchIpAddress() {
    try {
      if (this.proxy) {
        const agent = this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url);
        const response = await axios.get('https://api.ipify.org?format=json', {
          httpsAgent: agent,
          httpAgent: agent,
        });
        this.ipAddress = response.data.ip;
      } else {
        const response = await axios.get('https://api.ipify.org?format=json');
        this.ipAddress = response.data.ip;
      }
    } catch (error) {
      this.ipAddress = 'Unknown';
      this.addLog(chalk.red(`Failed to fetch IP: ${error.message}`));
    }
  }

  async fetchUserInfo() {
    try {
      const headers = {
        Authorization: `Bearer ${this.account.accessToken}`,
      };
      let config = { headers };
      if (this.proxy) {
        const agent = this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url);
        config = { ...config, httpsAgent: agent, httpAgent: agent };
      }
      const response = await axios.get('https://api-hunter.membit.ai/auth/whoami', config);
      this.userInfo = response.data;
      this.totalPoints = this.userInfo.point || 0;
      this.refreshDisplay();
    } catch (error) {
      this.addLog(chalk.red(`Failed to fetch user info: ${error.message}`));
    }
  }

  startPeriodicFetch() {
    this.fetchNextEpoch();
    this.fetchInterval = setInterval(() => this.fetchNextEpoch(), 10000);
    this.countdownInterval = setInterval(() => this.updateCountdowns(), 1000);
  }

  async fetchNextEpoch() {
    try {
      const headers = {
        Authorization: `Bearer ${this.account.accessToken}`,
      };
      let config = { headers };
      if (this.proxy) {
        const agent = this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url);
        config = { ...config, httpsAgent: agent, httpAgent: agent };
      }
      const response = await axios.get('https://api-hunter.membit.ai/points/next_epoch', config);
      const data = response.data;
      this.epochId = data.epoch_id;
      this.nextEpochTime = new Date(data.estimated_end_time).getTime();
      this.eligiblePostsCount = data.eligible_posts_count;
      this.estimatedEpochPoints = data.estimated_epoch_points;
      this.totalPoints = data.accumulated_points;
      this.status = 'Connected';
      this.addLog(chalk.green(`Fetched next epoch: ID ${this.epochId}, Est Points ${this.estimatedEpochPoints}`));
      this.refreshDisplay();
    } catch (error) {
      this.addLog(chalk.red(`Failed to fetch next epoch: ${error.message}`));
      this.status = 'Error';
      this.refreshDisplay();
    }
  }

  updateCountdowns() {
    if (this.nextEpochTime) {
      const remainingEpoch = this.nextEpochTime - Date.now();
      if (remainingEpoch <= 0) {
        this.nextEpochCountdown = '00:00';
      } else {
        const minutes = Math.floor(remainingEpoch / 60000);
        const seconds = Math.floor((remainingEpoch % 60000) / 1000);
        this.nextEpochCountdown = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    }

    if (this.nextScrollTime) {
      const remainingScroll = this.nextScrollTime - Date.now();
      if (remainingScroll <= 0) {
        this.nextScrollCountdown = '00:00';
      } else {
        const minutes = Math.floor(remainingScroll / 60000);
        const seconds = Math.floor((remainingScroll % 60000) / 1000);
        this.nextScrollCountdown = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    }

    if (this.isDisplayed) {
      this.refreshDisplay();
    }
  }

  addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] [Node ${this.id}] ${message.replace(/\{[^}]+\}/g, '')}`;
    this.logs.push(logMessage);
    if (this.logs.length > 100) this.logs.shift();
    if (this.logPane && this.isDisplayed) {
      this.logPane.setContent(this.logs.join('\n'));
      this.logPane.setScrollPerc(100);
      this.uiScreen.render();
    }
  }

  refreshDisplay() {
    if (!this.isDisplayed || !this.accountPane || !this.logPane) return;
    const statusColor = this.status === 'Connected' ? 'green' : 'red';
    const info = `
 Username      : {magenta-fg}${this.userInfo.twitter_handle || 'N/A'}{/magenta-fg}
 User ID       : {magenta-fg}${this.userInfo.id || 'N/A'}{/magenta-fg}
 Total Points  : {green-fg}${this.totalPoints}{/green-fg}
 Est Pts/Epoch : {yellow-fg}${this.estimatedEpochPoints}{/yellow-fg}
 Eligible Post : {blue-fg}${this.eligiblePostsCount}{/blue-fg}
 Epoch ID      : {cyan-fg}${this.epochId}{/cyan-fg}
 Next Epoch    : {cyan-fg}${this.nextEpochCountdown}{/cyan-fg}
 Next X Scroll : {cyan-fg}${this.nextScrollCountdown}{/cyan-fg}
 Status        : {${statusColor}-fg}${this.status}{/}
 IP Address    : {cyan-fg}${this.ipAddress}{/cyan-fg}
 Proxy         : {cyan-fg}${this.proxy ? `${this.proxy.url} (${this.proxy.type})` : 'None'}{/cyan-fg}
    `;
    this.accountPane.setContent(info);
    this.logPane.setContent(this.logs.join('\n'));
    this.logPane.setScrollPerc(100);
    this.uiScreen.render();
  }

  cleanup() {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
      this.scrollInterval = null;
    }
  }

  async startAutoScroll() {
    await this.performXScroll();
    this.resetScrollCountdown();
    this.scrollInterval = setInterval(async () => {
      if (!this.isScrolling) {
        await this.performXScroll();
      } else {
        this.addLog(chalk.yellow('Scroll skipped: Previous scroll still in progress'));
      }
    }, 30 * 60 * 1000);
  }

  resetScrollCountdown() {
    this.nextScrollTime = Date.now() + 30 * 60 * 1000;
    this.updateCountdowns();
  }

  async performXScroll() {
    if (this.isScrolling) {
      this.addLog(chalk.yellow('Scroll already in progress, skipping'));
      return;
    }
    this.isScrolling = true;
    this.addLog(chalk.blue('Starting Data collection...'));
    try {
      const collected = await this.fetchAllPages();
      this.addLog(chalk.blue(`Collected ${collected.length} items from X timeline.`));

      if (collected.length > 0) {
        await this.submitPosts(collected);
      } else {
        this.addLog(chalk.yellow('No items collected this scroll.'));
      }
    } catch (error) {
      this.addLog(chalk.red(`Error during X scroll: ${error.message}`));
    } finally {
      this.isScrolling = false;
      this.resetScrollCountdown();
    }
  }

  async uploadImage(imageUrl) {
    try {
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);
      const contentType = imageResponse.headers['content-type'];

      const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
      const uuid = [
        hash.substring(0, 8),
        hash.substring(8, 12),
        hash.substring(12, 16),
        hash.substring(16, 20),
        hash.substring(20, 32),
      ].join('-');
      const extension = contentType.split('/')[1] || 'jpg';
      const candidatePublicUrl = `https://img.membit.ai/v2/${uuid}.${extension}`;
      try {
        const checkResponse = await axios.get(candidatePublicUrl, { headers: { Range: 'bytes=0-0' } });
        if (checkResponse.status === 206 || checkResponse.status === 200) {
          this.addLog(chalk.green(`Image already exists: ${candidatePublicUrl}`));
          return candidatePublicUrl;
        }
      } catch (checkError) {
        if (checkError.response && (checkError.response.status === 404 || checkError.response.status === 416)) {
        } else {
          throw checkError;
        }
      }
      const headers = {
        Authorization: `Bearer ${this.account.accessToken}`,
        'Content-Type': 'application/json',
      };
      let config = { headers };
      if (this.proxy) {
        const agent = this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url);
        config = { ...config, httpsAgent: agent, httpAgent: agent };
      }
      const uploadUrlResponse = await axios.post('https://api-hunter.membit.ai/posts/generate_upload_url', {
        original_url: imageUrl,
        checksum_sha256_hex: hash,
        content_type: contentType,
      }, config);
      const uploadData = uploadUrlResponse.data;

      if (!uploadData.upload_url) {
        this.addLog(chalk.green(`Image already uploaded: ${uploadData.public_url}`));
        return uploadData.public_url;
      }

      const putHeaders = {
        'x-amz-checksum-sha256': uploadData.x_amz_checksum_sha256,
        'Content-Type': contentType,
      };
      await axios.put(uploadData.upload_url, imageBuffer, { headers: putHeaders });

      this.addLog(chalk.green(`Image uploaded: ${uploadData.public_url}`));
      return uploadData.public_url;
    } catch (error) {
      this.addLog(chalk.red(`Failed to upload image ${imageUrl}: ${error.message}`));
      return imageUrl; 
    }
  }

  async fetchAllPages() {
    const GRAPHQL_ENDPOINT = 'https://x.com/i/api/graphql/i-osUr1ggVtNkzSgVkUdrA/HomeTimeline';
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Connection": "keep-alive",
      "Accept": "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
      "Content-Type": "application/json",
      "x-csrf-token": this.account.csrf,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "cookie": this.account.cookie || "",
    };

    const collected = [];
    let cursor = null;
    const variables = {
      count: 40,
      cursor: null,
      includePromotedContent: true,
      latestControlAvailable: true,
      withCommunity: true,
      seenTweetIds: this.seenTweetIds,
    };
    const features = {
      rweb_video_screen_enabled: false,
      payments_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: false,
      responsive_web_grok_analyze_post_followups_enabled: true,
      responsive_web_jetfuel_frame: true,
      responsive_web_grok_share_attachment_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      responsive_web_grok_show_grok_translated_post: false,
      responsive_web_grok_analysis_button_from_backend: true,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_imagine_annotation_enabled: true,
      responsive_web_grok_community_note_auto_translation_is_enabled: false,
      responsive_web_enhance_cards_enabled: false
    };

    let page = 0;
    const maxItems = 100;
    while (collected.length < maxItems) {
      page++;
      variables.cursor = cursor;
      let resp;
      try {
        resp = await axios.post(GRAPHQL_ENDPOINT, { variables, features, queryId: "i-osUr1ggVtNkzSgVkUdrA" }, { headers });
      } catch (err) {
        this.addLog(chalk.red(`GraphQL POST failed: ${err.message}`));
        break;
      }
      const itemsPage = this.extractItemsFromHomeTimeline(resp.data || {});
      collected.push(...itemsPage);
      if (collected.length >= maxItems) break;
      const nextCursor = this.extractCursorFromResponse(resp.data || {});
      if (!nextCursor) break;
      cursor = nextCursor;
      await new Promise(r => setTimeout(r, 300));
    }

    const tweetIds = collected.map(it => it.data?.tweetId).filter(Boolean);
    if (tweetIds.length > 0) {
      this.seenTweetIds = [...new Set([...this.seenTweetIds, ...tweetIds])].slice(-50); 
    }

    return collected.slice(0, maxItems);
  }

  extractCursorFromResponse(resp) {
    try {
      const instrs = (((resp || {}).data || {}).home || {}).home_timeline_urt?.instructions || [];
      for (const ins of instrs) {
        if (!ins || !ins.entries) continue;
        for (const e of ins.entries) {
          if (e?.content?.operation?.cursor) {
            const v = e.content.operation.cursor.value || e.content.operation.cursor.cursor;
            if (v) return v;
          }
          if (e?.content?.cursor) {
            const cv = e.content.cursor.value || e.content.cursor.cursor;
            if (cv) return cv;
          }
          if (e?.content?.timelineModule && e.content.timelineModule.cursor) return e.content.timelineModule.cursor;
        }
      }
    } catch (e) {}
    if (resp?.data?.home?.home_timeline_urt?.cursor) return resp.data.home.home_timeline_urt.cursor;
    return null;
  }

  extractItemsFromHomeTimeline(resp) {
    const out = [];
    const instrs = (((resp || {}).data || {}).home || {}).home_timeline_urt?.instructions || [];
    for (const ins of instrs) {
      if (ins.type !== 'TimelineAddEntries' || !Array.isArray(ins.entries)) continue;
      for (const entry of ins.entries) {
        try {
          const ic = entry?.content?.itemContent;
          if (!ic) continue;
          if (ic.itemType === 'TimelineTweet') {
            const tweet = ic.tweet_results?.result || {};
            const legacy = tweet.legacy || {};
            const user = tweet.core?.user_results?.result || {};
            const authorHandle = user?.legacy?.screen_name || (user?.core && user.core.screen_name) || 'unknown';
            if (authorHandle === 'unknown') continue;
            const authorName = user?.legacy?.name || (user?.core && user.core.name) || '';
            const restId = tweet.rest_id || legacy.id_str || null;
            if (!restId) continue; 
            const url = `https://x.com/${authorHandle}/status/${restId}`;
            const profileImage = user?.legacy?.profile_image_url_https || '';

            const likesNum = legacy.favorite_count ?? 0;
            const repliesNum = legacy.reply_count ?? 0;
            const repostsNum = legacy.retweet_count ?? 0;

            const content = legacy.full_text || legacy.text || '';
            if (content.trim() === '') continue; 

            const timestampStr = legacy.created_at || tweet.created_at;
            const timestamp = timestampStr ? new Date(timestampStr).toISOString() : new Date().toISOString();

            const mentioned = (legacy.entities?.user_mentions || []).map(m => `@${m.screen_name}`);

            const data = {
              url,
              author: {
                name: authorName,
                handle: `@${authorHandle}`,
                profile_image: profileImage,
              },
              timestamp,
              content,
              likes: likesNum,
              retweets: repostsNum,
              replies: repliesNum,
              mentioned,
            };

            if (restId) data.tweetId = String(restId);

            out.push({ data });
          }
        } catch (e) {
          this.addLog(chalk.yellow(`Warn: parse entry error: ${e.message}`));
        }
      }
    }
    this.addLog(chalk.blue(`Parsed ${out.length} items from response`));
    return out;
  }

  async submitPosts(items) {
    this.addLog(chalk.blue(`Submitting ${items.length} posts...`));
    for (const item of items) {
      const postData = item.data;
      if (this.submittedUrls.has(postData.url)) {
        this.addLog(chalk.yellow(`Skipping duplicate post: ${postData.url}`));
        continue;
      }
      try {
        const headers = {
          Authorization: `Bearer ${this.account.accessToken}`,
          'Content-Type': 'application/json',
        };
        let config = { headers };
        if (this.proxy) {
          const agent = this.proxy.type === 'socks5' ? new SocksProxyAgent(this.proxy.url) : new HttpsProxyAgent(this.proxy.url);
          config = { ...config, httpsAgent: agent, httpAgent: agent };
        }

        if (postData.author.profile_image) {
          postData.author.profile_image = await this.uploadImage(postData.author.profile_image);
        }

        const postPayload = {
          url: postData.url,
          author: postData.author,
          timestamp: postData.timestamp,
          content: postData.content,
        };
        if (postData.mentioned && postData.mentioned.length > 0) {
          postPayload.mentioned = postData.mentioned;
        }
        const postResponse = await axios.post('https://api-hunter.membit.ai/posts/submit', postPayload, config);
        const { post_uuid, expected_epoch_points } = postResponse.data;
        this.addLog(chalk.green(`Submitted post: UUID ${post_uuid}`));
        this.submittedUrls.add(postData.url);

        const engagementsPayload = {
          post_uuid,
          url: postData.url,
          likes: postData.likes,
          retweets: postData.retweets,
          replies: postData.replies,
        };
        const engagementsResponse = await axios.post('https://api-hunter.membit.ai/engagements/submit', engagementsPayload, config);
        this.addLog(chalk.green(`Submitted engagements for UUID ${post_uuid}`));

        await new Promise(r => setTimeout(r, 5000)); 
      } catch (error) {
        let errorDetail = error.message;
        if (error.response) {
          errorDetail += ` - Response data: ${JSON.stringify(error.response.data, null, 2)}`;
        }
        this.addLog(chalk.red(`Failed to submit post ${postData.url}: ${errorDetail} (likely duplicate, irrelevant, or invalid data)`));
      }
    }
  }

  static async loadAccounts() {
    try {
      const filePath = path.join(__dirname, 'account.txt');
      const data = await fs.readFile(filePath, 'utf8');
      const accountsRaw = data.split('\n\n').filter(block => block.trim() !== '');
      const accounts = [];

      for (const block of accountsRaw) {
        const lines = block.split('\n').filter(line => line.trim() !== '');
        const account = {};
        for (const line of lines) {
          const [key, ...valueParts] = line.split('=');
          const value = valueParts.join('=').trim();
          if (key && value) {
            account[key.trim()] = value;
          }
        }
        if (account.accessToken && account.csrf && account.cookie) {
          accounts.push(account);
        } else {
          console.warn(`[WARN] Skipping invalid account block: missing required fields`);
        }
      }

      if (!accounts.length) {
        console.error('[ERROR] No valid accounts found in account.txt');
        return [];
      }
      return accounts.map((acc, index) => ({ id: index + 1, ...acc }));
    } catch (error) {
      console.error(`[ERROR] Failed to load account.txt: ${error.message}`);
      return [];
    }
  }

  static async loadProxies() {
    const proxies = [];
    try {
      const filePath = path.join(__dirname, 'proxy.txt');
      const data = await fs.readFile(filePath, 'utf8');
      const lines = data.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
      for (const line of lines) {
        const proxyRegex = /^(socks5|http|https):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/i;
        const match = line.match(proxyRegex);
        if (!match) {
          proxies.push({ error: `Invalid proxy format: ${line}. Expected 'socks5://[user:pass@]host:port' or 'http(s)://[user:pass@]host:port', skipping.` });
          continue;
        }
        const [, scheme, username, password, host, port] = match;
        const type = scheme.toLowerCase() === 'socks5' ? 'socks5' : 'http';
        const auth = username && password ? `${username}:${password}@` : '';
        const url = `${scheme}://${auth}${host}:${port}`;
        proxies.push({ type, url });
      }
      if (!proxies.filter(p => !p.error).length) {
        proxies.push({ error: 'No valid proxies found in proxy.txt. Running without proxy.' });
      }
      return proxies;
    } catch (error) {
      proxies.push({ error: `Failed to read proxy.txt: ${error.message}. Running without proxy.` });
      return proxies;
    }
  }
}

async function main() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'NT EXHAUST - Membit Auto Bot',
  });

  const headerPane = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 7,
    tags: true,
    align: 'left',
  });
  screen.append(headerPane);

  function renderBanner() {
    const threshold = 80;
    const margin = Math.max(screen.width - 80, 0);
    let art = "";
    if (screen.width >= threshold) {
      art = cfonts.render('NT EXHAUST', {
        font: 'block',
        align: 'center',
        colors: ['cyan', 'magenta'],
        background: 'transparent',
        letterSpacing: 1,
        lineHeight: 1,
        space: true,
        maxLength: screen.width - margin,
      }).string;
    } else {
      art = cfonts.render('NT EXHAUST', {
        font: 'tiny',
        align: 'center',
        colors: ['cyan', 'magenta'],
        background: 'transparent',
        letterSpacing: 1,
        lineHeight: 1,
        space: true,
        maxLength: screen.width - margin,
      }).string;
    }
    headerPane.setContent(art + '\n');
    headerPane.height = Math.min(8, art.split('\n').length + 2);
  }
  renderBanner();

  const channelPane2 = blessed.box({
    top: '30%',
    left: 2,
    width: '100%',
    height: 2,
    tags: false,
    align: 'center',
  });
  channelPane2.setContent('✪ BOT MEMBIT AUTO RUN NODE ✪');
  screen.append(channelPane2);

  const infoPane = blessed.box({
    bottom: 0,
    left: 'center',
    width: '100%',
    height: 2,
    tags: true,
    align: 'center',
  });
  screen.append(infoPane);

  const dashTop = headerPane.height + channelPane2.height;
  const accountPane = blessed.box({
    top: dashTop,
    left: 0,
    width: '50%',
    height: '60%',
    border: { type: 'line' },
    label: ' User Info ',
    tags: true,
    style: { border: { fg: 'yellow' }, fg: 'white', bg: 'default' },
  });
  screen.append(accountPane);

  const logPane = blessed.log({
    top: dashTop,
    left: '50%',
    width: '50%',
    height: '60%',
    border: { type: 'line' },
    label: ' System Logs ',
    tags: true,
    style: { border: { fg: 'yellow' }, fg: 'white', bg: 'default' },
    scrollable: true,
    scrollbar: { bg: 'blue', fg: 'white' },
    alwaysScroll: true,
    mouse: true,
    keys: true,
  });
  screen.append(logPane);

  logPane.on('keypress', (ch, key) => {
    if (key.name === 'up') {
      logPane.scroll(-1);
      screen.render();
    } else if (key.name === 'down') {
      logPane.scroll(1);
      screen.render();
    } else if (key.name === 'pageup') {
      logPane.scroll(-10);
      screen.render();
    } else if (key.name === 'pagedown') {
      logPane.scroll(10);
      screen.render();
    }
  });

  logPane.on('mouse', (data) => {
    if (data.action === 'wheelup') {
      logPane.scroll(-2);
      screen.render();
    } else if (data.action === 'wheeldown') {
      logPane.scroll(2);
      screen.render();
    }
  });

  let accounts = await MembitNode.loadAccounts();
  let proxies = await MembitNode.loadProxies();
  let activeIndex = 0;
  let nodes = [];

  function updateNodes() {
    nodes.forEach(node => node.cleanup());
    nodes = accounts.map((account, idx) => {
      const proxyEntry = proxies[idx % proxies.length] || null;
      const proxy = proxyEntry && !proxyEntry.error ? { ...proxyEntry } : null;
      const node = new MembitNode(account, proxy, account.id);
      node.uiScreen = screen;
      node.accountPane = accountPane;
      node.logPane = logPane;
      if (proxyEntry && proxyEntry.error) {
        node.addLog(chalk.yellow(proxyEntry.error));
      }
      return node;
    });

    if (nodes.length > 0) {
      nodes[activeIndex].isDisplayed = true;
      nodes[activeIndex].addLog(chalk.green('Node initialized successfully'));
      nodes[activeIndex].refreshDisplay();
      nodes.forEach(node => node.start());
    } else {
      logPane.setContent('No valid accounts found in account.txt.\nPress \'q\' or Ctrl+C to exit.');
      accountPane.setContent('');
      screen.render();
    }
  }

  updateNodes();

  if (!nodes.length) {
    screen.key(['escape', 'q', 'C-c'], () => {
      screen.destroy();
      process.exit(0);
    });
    screen.render();
    return;
  }

  infoPane.setContent(`Current Account: ${nodes.length > 0 ? activeIndex + 1 : 0}/${nodes.length} | Use Left/Right arrow keys to switch accounts.`);

  screen.key(['escape', 'q', 'C-c'], () => {
    nodes.forEach(node => {
      node.cleanup();
      node.addLog(chalk.yellow('Node stopped'));
    });
    screen.destroy();
    process.exit(0);
  });

  screen.key(['right'], () => {
    if (nodes.length === 0) return;
    nodes[activeIndex].isDisplayed = false;
    activeIndex = (activeIndex + 1) % nodes.length;
    nodes[activeIndex].isDisplayed = true;
    nodes[activeIndex].refreshDisplay();
    infoPane.setContent(`Current Account: ${activeIndex + 1}/${nodes.length} | Use Left/Right arrow keys to switch accounts.`);
    screen.render();
  });

  screen.key(['left'], () => {
    if (nodes.length === 0) return;
    nodes[activeIndex].isDisplayed = false;
    activeIndex = (activeIndex - 1 + nodes.length) % nodes.length;
    nodes[activeIndex].isDisplayed = true;
    nodes[activeIndex].refreshDisplay();
    infoPane.setContent(`Current Account: ${activeIndex + 1}/${nodes.length} | Use Left/Right arrow keys to switch accounts.`);
    screen.render();
  });

  screen.key(['tab'], () => {
    logPane.focus();
    screen.render();
  });

  screen.on('resize', () => {
    renderBanner();
    headerPane.width = '100%';
    channelPane2.top = headerPane.height;
    accountPane.top = dashTop;
    logPane.top = dashTop;
    screen.render();
  });

  screen.render();
}

main().catch(error => {
  console.error(`[ERROR] Failed to start: ${error.message}`);
  const screen = blessed.screen({ smartCSR: true, title: 'NT EXHAUST Membit Runner' });
  const logPane = blessed.box({
    top: 'center',
    left: 'center',
    width: '80%',
    height: '100%',
    border: { type: 'line' },
    label: ' System Logs ',
    content: `Failed to start: ${error.message}\nPlease fix the issue and restart.\nPress 'q' or Ctrl+C to exit`,
    style: { border: { fg: 'red' }, fg: 'blue', bg: 'default' },
  });
  screen.append(logPane);
  screen.key(['escape', 'q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });
  screen.render();
});
