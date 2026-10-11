/**
 * dsh-daily · 零依赖 RSS/Atom 解析器单元测试
 *
 * 运行：`cd packages/dsh-daily && node --test test/rss.test.js`
 * （Node ≥ 22.18 原生擦除类型，可直接 import `.ts`；本测试**不依赖网络**。）
 *
 * 真实样本抓取时间：2026-10-12 00:50 (+08:00)，源见每段 fixture 上方注释；
 * 均按「头部 + 前 2~3 条 item 原文」截断后内联，内容为原样拷贝（长正文另有标注的截断）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseFeed, cleanText, absoluteUrl } from '../src/collect/rss.ts'

/* ================================================================== *
 * 真实世界样本（截断内联）
 * ================================================================== */

// --- 少数派 sspai RSS 2.0  (https://sspai.com/feed) 抓取时间 2026-10-12 00:50 (+08:00)
const FX_SSPAI = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>少数派</title><link>https://sspai.com</link><description>少数派致力于更好地运用数字产品或科学方法，帮助用户提升工作效率和生活品质</description><language>zh-CN</language><managingEditor>contact@sspai.com (少数派)</managingEditor><pubDate>Sun, 11 Oct 2026 15:00:49 +0800</pubDate><item><title>写给「跑两步就喘」的你：不能忽略的跑后拉伸与恢复</title><link>https://sspai.com/post/115568</link><description>前面两篇文章我们介绍了想要舒适跑步，在跑前和跑步中的一些小技巧，今天和大家聊聊跑后如何正确的拉伸，如何更好地帮助身体恢复。关联阅读：跑前精准热身，缓解跑时疼痛调整跑步姿势，舒适开跑正确拉伸多数人跑后会 ...&lt;a href=&#34;https://sspai.com/post/115568&#34; target=&#34;_blank&#34;&gt;查看全文&lt;/a&gt;</description><author>阿帅的健康笔记</author><pubDate>Sun, 11 Oct 2026 15:00:49 +0800</pubDate></item><item><title>App+1｜专注星空：让「少刷手机」这件事更愉悦一点</title><link>https://sspai.com/post/115237</link><description>把决定使用时长的时机，放到每次打开应用之前。&lt;a href=&#34;https://sspai.com/post/115237&#34; target=&#34;_blank&#34;&gt;查看全文&lt;/a&gt;</description><author>少玩手机多睡觉</author><pubDate>Sat, 10 Oct 2026 10:19:52 +0800</pubDate></item></channel></rss>`
// --- Solidot RSS 2.0（CDATA 标题/链接）  (https://www.solidot.org/index.rss) 抓取时间 2026-10-12 00:50 (+08:00)
const FX_SOLIDOT = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>奇客Solidot&#8211;传递最新科技情报</title>
<link>https://www.solidot.org</link>
<description><![CDATA[奇客的知识，重要的东西。]]></description>
<atom:link href="https://www.solidot.org/index.rss" rel="self" type="application/rss+xml"></atom:link>
<language>zh-cn</language>
<pubDate>Mon, 12 Oct 2026 00:48:00 +0800</pubDate>
<ttl>20</ttl>
<item>
<title><![CDATA[英国水果蔬菜营养价值下降最高五成]]></title>
<link><![CDATA[https://www.solidot.org/story?sid=85580]]></link>
<description><![CDATA[Deep Science Ventures 研究人员的一项研究发现，英国水果和蔬菜的营养价值自 1960 年代以来减少最高五成。英国民众现在需要食用两倍数量的蔬菜，才能摄入与 60 年前同等水平的矿物质如钾、镁或铜。许多农作物中几种关键营养素的含量减少了 20%-50%。营养和维生素含量的下降主要归因于土壤质量的退化，以及作物在育种时过度追求快速生长，而忽视了其营养价值。正使用减肥药物的人群面临的营养匮乏风险可能最大，因为减肥药会导致他们的食物摄入量显著减少。
<p></p>
]]></description>
<pubDate>Sun, 11 Oct 2026 22:27:04 +0800</pubDate>
</item><item>
<title><![CDATA[LineageOS 24 释出]]></title>
<link><![CDATA[https://www.solidot.org/story?sid=85579]]></link>
<description><![CDATA[Android 社区发行版项目 LineageOS 释出了基于 Android 17 的 LineageOS 24。2026 年 12 月 24 日，LineageOS 将迎来十周年纪念。开发者表示这是一个重要的里程碑，期望继续走向下一个十年。LineageOS 24 主要变化包括：合并了截至 2026 年 10 月的安全补丁，新的图像编辑器 Canvas 可满足基本的照片编辑需求，Android TV 启动器 Catapult；为移动设备和掌机添加电量指示器；一系列应用更新，等等。
<p></p>
]]></description>
<pubDate>Sun, 11 Oct 2026 22:16:29 +0800</pubDate>
</item></channel>
</rss>`
// --- 阮一峰 Atom 1.0（含 rel=self）  (https://www.ruanyifeng.com/blog/atom.xml) 抓取时间 2026-10-12 00:50 (+08:00)
const FX_RUANYIFENG = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>阮一峰的网络日志</title>
    <link rel="alternate" type="text/html" href="http://www.ruanyifeng.com/blog/" />
    <link rel="self" type="application/atom+xml" href="http://www.ruanyifeng.com/blog/atom.xml" />
    <id>tag:www.ruanyifeng.com,2010-04-11:/blog//1</id>
    <updated>2026-10-11T11:41:55Z</updated>
    <subtitle>Ruan YiFeng&apos;s Blog</subtitle>
    <generator uri="http://www.sixapart.com/movabletype/">Movable Type 5.2.2</generator>

<entry>
    <title>科技爱好者周刊（第 414 期）：Jev 决策模型有什么用</title>
    <link rel="alternate" type="text/html" href="http://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html" />
    <id>tag:www.ruanyifeng.com,2026:/blog//1.2558</id>

    <published>2026-10-08T15:04:46Z</published>
    <updated>2026-10-11T11:41:55Z</updated>

    <summary>这里记录每周值得分享的科技内容，周五发布。...</summary>
    <author>
        <name>阮一峰</name>
        <uri>http://www.ruanyifeng.com</uri>
    </author>
    
        <category term="Weekly" scheme="http://www.sixapart.com/ns/types#category" />
    
    
    <content type="html" xml:lang="en" xml:base="http://www.ruanyifeng.com/blog/"><![CDATA[<p>这里记录每周值得分享的科技内容，周五发布。</p>
]]>
        <![CDATA[<p>本杂志<a href="https://github.com/ruanyf/weekly">开源</a>，欢迎<a href="https://github.com/ruanyf/weekly/issues">投稿</a>。另有<a href="https://github.com/ruanyf/weekly/issues/12009">《谁在招人》</a>服务，发布程序员招聘信息。合作请<a href="mailto:yifeng.ruan@gmail.com">邮件联系</a>（yifeng.ruan@gmail.com）。</p>

<h2>封面图</h2>

<p><img src="https://cdn.beekka.com/blogimg/asset/202610/bg2026100816.webp" alt="" title="" /></p>

<p>国产首列数字地铁列车 VELLINK，完全无人驾驶，车头改成了大幅玻璃，用于观光。（<a href="https://jl.chinadaily.com.cn/a/202609/23/WS6ab3be35e4b09a165c78c53d.html">via</a>）</p>

<h2>Jev 决策模型有什么用</h2>

<p>上个月，最大的 AI 新闻不是 GPT 或 Claude 模型的新版本，而是一家名不见经传的公司 <a href="https://typesafe.ai/">TypeSafe AI<…（原文已截断）]]></content>
</entry><entry>
    <title>科技爱好者周刊（第 413 期）：再见了，React Native</title>
    <link rel="alternate" type="text/html" href="http://www.ruanyifeng.com/blog/2026/09/weekly-issue-413.html" />
    <id>tag:www.ruanyifeng.com,2026:/blog//1.2557</id>

    <published>2026-09-18T00:03:02Z</published>
    <updated>2026-10-11T12:23:09Z</updated>

    <summary>这里记录每周值得分享的科技内容，周五发布。（[通知] 下周五开始的中秋和十一假期，周刊休息。）...</summary>
    <author>
        <name>阮一峰</name>
        <uri>http://www.ruanyifeng.com</uri>
    </author>
    
        <category term="Weekly" scheme="http://www.sixapart.com/ns/types#category" />
    
    
    <content type="html" xml:lang="en" xml:base="http://www.ruanyifeng.com/blog/"><![CDATA[<p>这里记录每周值得分享的科技内容，周五发布。（<strong>[通知] 下周五开始的中秋和十一假期，周刊休息。</strong>）</p>
]]>
        <![CDATA[<p>本杂志<a href="https://github.com/ruanyf/weekly">开源</a>，欢迎<a href="https://github.com/ruanyf/weekly/issues">投稿</a>。另有<a href="https://github.com/ruanyf/weekly/issues/11434">《谁在招人》</a>服务，发布程序员招聘信息。合作请<a href="mailto:yifeng.ruan@gmail.com">邮件联系</a>（yifeng.ruan@gmail.com）。</p>

<h2>封面图</h2>

<p><img src="https://cdn.beekka.com/blogimg/asset/202609/bg2026091701.webp" alt="" title="" /></p>

<p>华东师范大学闵行校区新启用的西校门，仿造了它的前身之一光华大学的校门。（<a href="https://www.ecnu.edu.cn/info/1426/73055.htm">via</a>）</p>

<h2>再见了，React Native</h2>

<p>Shopify <a href="https://shopify.engineering/back-to-native">宣布</a>，放弃 React Nat…（原文已截断）]]></content>
</entry></feed>`
// --- IT之家 RSS 2.0（实体转义的 HTML 描述）  (https://www.ithome.com/rss/) 抓取时间 2026-10-12 00:50 (+08:00)
const FX_ITHOME = `<rss version="2.0">
  <channel>
    <title>IT之家</title>
    <language>zh-cn</language>
    <pubDate>Sun, 11 Oct 2026 16:47:00 GMT</pubDate>
    <generator>ITHome.com</generator>
    <description>IT之家 - 软媒旗下网站</description>
    <link>https://www.ithome.com/</link>
    <item>
      <title>李杰回应一加 16 不支持全局 185Hz：产品追求体验优先，屏幕暂时做不到</title>
      <description>&lt;p data-vmark="ce6c"&gt;IT之家 10 月 11 日消息，一加中国区总裁李杰今日在微博评论区回应关于一加 16 屏幕刷新率相关问题，&lt;/p&gt;&lt;p data-vmark="39f3"&gt;据其介绍，一加 16 追求体验优先，不是参数优先。要同时兼顾流畅，功耗，发热，屏幕显示效果，现在的屏幕技术&lt;strong&gt;暂时做不到全局 185Hz&lt;/strong&gt;。全局高刷要做到常用常开，目前最佳体验就是全局 165Hz，欢迎大家上手一加 16 去对比其他手机。&lt;/p&gt;&lt;p style="text-align: center;" data-vmark="fa7e"&gt;&lt;img src="https://img.ithome.com/newsuploadfiles/2026/10/13b80987-aa94-4f25-a2a3-ee4b9c5c04ef.png?x-bce-process=image/format,f_auto" w="585" h="159" data-snap-from="%7B%22from%22%3A%22weibo%22%2C%22url%22%3A%22https%3A%2F%2Fweibo.com%2F7582893032%22%2C%22qualityMode%22%3A%22auto%22%2C%22qualityValue%22%3A%22original%22%7D" data-weibo="0" data-mpos="2,1" data-marks="1931fd9d012eb6d1e3f2c4d667e334e2309c30c0f777f3703d7c131cac26b91400f3692b728593ba817dfa48d7998012" data-vmark="46b2" class="no-alt-img"&gt;&lt;/p&gt;&lt;p data-vmark="a100"&gt;IT之家注意到，在 10 月 9 日的第四代东方屏技术沟通会上，一加与京东方联合研发的第四代东方屏正式发布。第四代东方屏采用全新 X4 发光材料，宣称“色彩准、高刷稳、画面亮、功耗低、寿命长”；支持真硬件 1nit，夜间看屏幕，柔和不刺眼。&lt;/p&gt;&lt;p style="text-align: center;" data-vmark="f821"&gt;&lt;img src="https://img.ithome.com/newsuploadfiles/2026/10/bac2c2ab-b464-4a27-aa94-c48aca7fb012.jpg" w="1440" h="743" data-vmark="4e4e" data-mpos="2,2"  data-weibo="1" class="no-alt-img"&gt;&lt;/p&gt;&lt;p data-vmark="a7d6"&gt;第四代东方屏宣称做到行业首个全链路硬件全局超高刷，带来全球首个“日常 165Hz”。日常使用支持全局 165Hz 超高刷，百万手机主流应用均可享受 165Hz 体验，&lt;strong&gt;游戏场景最高可达到 185Hz&lt;/strong&gt;。&lt;/p&gt;&lt;p data-vmark="ed59"&gt;一加 16 手机将首发搭载 185Hz 第四代东方屏，采用 1.15mm 极窄四等边屏幕，将于 10 月 12 日 19:00 正式发布。&lt;/p&gt;&lt;p class="j_iframe_show ithome-content-placeholder" style="text-align: center;" data-vmark="2ffb"&gt;&lt;iframe src="https://img.ithome.com/app/calendar/event_card.html?id=4813" frameborder="no"&gt;&lt;/iframe&gt;&lt;/p&gt;</description>
      <link>https://www.ithome.com/1/011/715.htm</link>
      <guid>https://www.ithome.com/1/011/715.htm</guid>
      <pubDate>Sun, 11 Oct 2026 15:28:59 GMT</pubDate>
    </item><item>
      <title>曝苹果新一代 Apple TV 4K 内置麦克风、Siri Remote 遥控器将配扬声器便于查找</title>
      <description>&lt;p data-vmark="98d1"&gt;IT之家 10 月 11 日消息，苹果将在本周二举行“欢迎回家”活动，主角预计是 HomeView 智能家庭中枢，除此之外还有新款 HomePod mini 和 Apple TV 4K。&lt;/p&gt;&lt;p style="text-align: center;" data-vmark="f9d7"&gt;&lt;img src="https://img.ithome.com/newsuploadfiles/2026/10/997ee68e-8b97-4bcb-86c2-f6815de99dea.jpg?x-bce-process=image/format,f_auto" w="1200" h="645" data-weibo="0" data-vmark="5903" class="no-alt-img"&gt;&lt;/p&gt;&lt;p data-vmark="be60"&gt;据彭博社记者马克 · 古尔曼今日透露，&lt;strong&gt;新款 Apple TV 4K 将在 10 月 30 日发售&lt;/strong&gt;，苹果已在这款新品中测试内置麦克风，用户直接说出 Siri 就能进行语音交互。&lt;/p&gt;&lt;p data-vmark="44b0"&gt;IT之家了解到，现款 Apple TV 4K 仅在 Siri Remote 中带有麦克风，用户必须对着遥控器或 HomePod 说话，才能使用 Siri。&lt;/p&gt;&lt;p data-vmark="7637"&gt;同时，苹果还将重新设计 Siri Remote 遥控器，&lt;strong&gt;这款配件将内置扬声器&lt;/strong&gt;，方便用户找出掉在沙发坐垫的遥控器。&lt;/p&gt;&lt;p data-vmark="ea10"&gt;此外，新款 HomePod mini 预计将配备 S10 芯片，同样也是 10 月 30 日发售。&lt;/p&gt;&lt;p class="j_iframe_show ithome-content-placeholder" style="text-align: center;" data-vmark="e8f3"&gt;&lt;iframe src="https://img.ithome.com/app/calendar/event_card.html?id=4856" frameborder="no"&gt;&lt;/iframe&gt;&lt;/p&gt;</description>
      <link>https://www.ithome.com/1/011/714.htm</link>
      <guid>https://www.ithome.com/1/011/714.htm</guid>
      <pubDate>Sun, 11 Oct 2026 15:20:30 GMT</pubDate>
    </item></channel></rss>`
// --- arXiv Atom 1.0（命名空间 + rel=related）  (https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&max_results=3) 抓取时间 2026-10-12 00:50 (+08:00)
const FX_ARXIV = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/R0SPnx8l8tIxrHMPwcpdin6AZn8</id>
  <title>arXiv Query: search_query=cat:cs.AI&amp;id_list=&amp;start=0&amp;max_results=3</title>
  <updated>2026-10-11T16:48:06Z</updated>
  <link href="https://arxiv.org/api/query?search_query=cat:cs.AI&amp;start=0&amp;max_results=3&amp;id_list=" type="application/atom+xml"/>
  <opensearch:itemsPerPage>3</opensearch:itemsPerPage>
  <opensearch:totalResults>205821</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/2610.12466v1</id>
    <title>On the estimation and validity of AI time horizons---a statistical look at the METR plot</title>
    <updated>2026-10-08T17:59:50Z</updated>
    <link href="https://arxiv.org/abs/2610.12466v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2610.12466v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>METR's 50\\% time horizon measures the human completion time of software tasks that an AI solves with 50\\% probability, allowing AI capabilities to be expressed in interpretable units. On 228 tasks and 26 AIs, we recompute the time horizons using splines and item-response theory to relax the assumption that the AI difficulty of a task depends linearly on the log of human time. Our fitted spline can be interpreted as a function that \\emph{converts} human time to AI difficulty; it is nearly flat in a region from 2--30 min but close to linear elsewhere. Hence, a time-horizon jump from 3 min to 30 min is much easier than one from 30 min to 5 hours despite the same multiplier of $10 \\times$. Overall, we contribute time-horizon point estimates that perform better under a cross-validated suite of proper scoring rules, as well as diagnostic plots for assessing time horizons' construct validity. We suggest that time horizons be interpreted together with the diagnostic plots, especially as new time-horizon-based benchmarks are proposed or existing ones grow to include longer tasks.</summary>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-10-08T17:59:50Z</published>
    <arxiv:primary_category term="cs.AI"/>
    <author>
      <name>Drew T. Nguyen</name>
    </author>
    <author>
      <name>William Fithian</name>
    </author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2610.12463v1</id>
    <title>From Reactive Containment to Proactive Assurance: Lessons from OpenAI, Anthropic, and Google Agent Security Incidents</title>
    <updated>2026-10-08T17:59:49Z</updated>
    <link href="https://arxiv.org/abs/2610.12463v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2610.12463v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>In 2026, cybersecurity evaluations involving OpenAI, Anthropic, and Google agents reached real systems outside their authorized test scope. The paths were different. OpenAI agents exploited research infrastructure, coordinated across runs, and compromised parts of Hugging Face's production environment. Anthropic reported cases in which a misconfigured third-party environment exposed real systems to agents pursuing simulated cyber tasks. In a separately reported evaluation, Google's Gemini accessed three real organizations through an unintended internet route; Google stated that the model stopped in all three instances. Taken together, the cases show why an evaluation cannot rely on an assumed boundary. That boundary must be verified while the agent is operating. This comparative instrumental case study develops a Proactive Agent Security Assurance Cycle (PASAC) and a five-layer Boundary Assurance Stack. The framework combines risk-tiered task design, executable scope contracts, pre-run validation, least-capability access, independent egress enforcement, credential restrictions, cross-run monitoring, automatic stop conditions, and evidence-based reauthorization. A leading-indicator model, nine design propositions, and seven falsifiable hypotheses turn these lessons into a testable research program. Because the public Gemini record is limited to attributed statements and journalism, its detailed causal mechanism remains provisional. The central conclusion is straightforward: proactive agent security requires continuous assurance across the full execution system, not confidence in any single sandbox or safeguard.</summary>
    <category term="cs.CR" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-10-08T17:59:49Z</published>
    <arxiv:comment>Conceptual research paper; includes one framework figure. The manuscript proposes a model-agnostic Boundary Assurance Stack for proactive security and accountable human oversight of high-capability AI agents</arxiv:comment>
    <arxiv:primary_category term="cs.CR"/>
    <author>
      <name>Abbas Raftari</name>
    </author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2610.12452v1</id>
    <title>BrickBench: Evaluating Agentic Brick Design</title>
    <updated>2026-10-08T17:58:56Z</updated>
    <link href="https://arxiv.org/abs/2610.12452v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2610.12452v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>We propose BrickBench, a benchmark for agentic text-conditioned LEGO-set design. Given a prompt, an agent is tasked with producing an assembly that not only satisfies semantic and design criteria, but that can also be physically built. To do so, it must select parts from a discrete library and reason jointly about local and global constraints. We score validity, alignment, and design across three settings that vary in scale and part availability. We provide BrickAgent, an environment for coding agents to construct, inspect, and validate their designs. We find that leading agents largely satisfy verifiable physical and semantic requirements, but fall short of human designs. We release our benchmark and environment at http://www.brickben.ch</summary>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.GR" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-10-08T17:58:56Z</published>
    <arxiv:comment>Project page: http://www.brickben.ch</arxiv:comment>
    <arxiv:primary_category term="cs.AI"/>
    <author>
      <name>Peter Kulits</name>
    </author>
    <author>
      <name>Yiqing Xu</name>
    </author>
    <author>
      <name>R. Kenny Jones</name>
    </author>
    <author>
      <name>Cordelia Schmid</name>
    </author>
    <author>
      <name>Jiajun Wu</name>
    </author>
  </entry>
</feed>
`
// --- RSSHub 镜像 YouTube（真实快照，实测该快照无 media:/itunes: 标签）  (https://rsshub.ktachibana.party/youtube/channel/UCbfYPyITQ-7l4upoX8nvctg) 抓取时间 2026-10-12 00:50 (+08:00)
const FX_YOUTUBE = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel><title>Two Minute Papers - YouTube</title><link>https://www.youtube.com/channel/UCbfYPyITQ-7l4upoX8nvctg</link><atom:link href="http://rsshub.ktachibana.party/youtube/channel/UCbfYPyITQ-7l4upoX8nvctg" rel="self" type="application/rss+xml"></atom:link><description>What a time to be alive! - Powered by RSSHub</description><generator>RSSHub</generator><webMaster>contact@rsshub.app (RSSHub)</webMaster><language>en</language><image><url>https://yt3.googleusercontent.com/ytc/AIdro_ljAkSpv16cJNUsE_rI1X-Kz9s78w1WNojUga-aZ1uVzEQ=s900-c-k-c0x00ffffff-no-rj</url><title>Two Minute Papers - YouTube</title><link>https://www.youtube.com/channel/UCbfYPyITQ-7l4upoX8nvctg</link></image><lastBuildDate>Sun, 11 Oct 2026 16:45:57 GMT</lastBuildDate><ttl>5</ttl><item><title>DeepMind&#39;s New AI Just Cracked The Code Of Life</title><description>&lt;iframe id=&quot;ytplayer&quot; type=&quot;text/html&quot; width=&quot;640&quot; height=&quot;360&quot; src=&quot;https://www.youtube-nocookie.com/embed/Wkaw03p3BrM&quot; frameborder=&quot;0&quot; allowfullscreen=&quot;&quot; referrerpolicy=&quot;strict-origin-when-cross-origin&quot;&gt;&lt;/iframe&gt;&lt;br&gt;</description><link>https://www.youtube.com/watch?v=Wkaw03p3BrM</link><guid isPermaLink="false">https://www.youtube.com/watch?v=Wkaw03p3BrM</guid><pubDate>Wed, 07 Oct 2026 16:45:57 GMT</pubDate><enclosure url="https://www.youtube-nocookie.com/embed/Wkaw03p3BrM?controls=1&amp;autoplay=1&amp;mute=0" length="0" type="text/html"></enclosure></item><item><title>The Billion Dollar AI Advantage Is Disappearing</title><description>&lt;iframe id=&quot;ytplayer&quot; type=&quot;text/html&quot; width=&quot;640&quot; height=&quot;360&quot; src=&quot;https://www.youtube-nocookie.com/embed/ZHVNTTKu9fU&quot; frameborder=&quot;0&quot; allowfullscreen=&quot;&quot; referrerpolicy=&quot;strict-origin-when-cross-origin&quot;&gt;&lt;/iframe&gt;&lt;br&gt;</description><link>https://www.youtube.com/watch?v=ZHVNTTKu9fU</link><guid isPermaLink="false">https://www.youtube.com/watch?v=ZHVNTTKu9fU</guid><pubDate>Mon, 05 Oct 2026 16:45:57 GMT</pubDate><enclosure url="https://www.youtube-nocookie.com/embed/ZHVNTTKu9fU?controls=1&amp;autoplay=1&amp;mute=0" length="0" type="text/html"></enclosure></item></channel></rss>`

/* ================================================================== *
 * 手写边界样本
 * ================================================================== */

const FEED_BASE = 'https://example.com/feed.xml'

/** Atom：feed 级与 entry 级都有 rel="self" / rel="replies"，用来验证不被当成正文链接 */
const FX_ATOM_SELF = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Self Link Guard</title>
  <link rel="self" href="https://example.com/feed.xml"/>
  <link rel="alternate" href="https://example.com/"/>
  <link rel="replies" href="https://example.com/feed/comments"/>
  <entry>
    <title>Entry One</title>
    <link rel="self" href="https://example.com/entry/1?format=atom"/>
    <link rel="replies" href="https://example.com/entry/1/comments"/>
    <link rel="alternate" href="https://example.com/entry/1"/>
    <id>tag:example.com,2026:1</id>
    <updated>2026-05-01T00:00:00Z</updated>
  </entry>
  <entry>
    <title>Entry Two</title>
    <link href="/entry/2"/>
    <id>tag:example.com,2026:2</id>
  </entry>
</feed>`

/** RSS 1.0 / RDF：item 与 channel 平级，稳定标识来自 rdf:about */
const FX_RDF = `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.com/">
    <title>示例 RDF 频道</title>
    <link>https://example.com/</link>
    <description>RDF 摘要</description>
  </channel>
  <item rdf:about="https://example.com/a">
    <title>RDF 条目 A</title>
    <link>https://example.com/a</link>
    <dc:date>2026-10-01T12:00:00Z</dc:date>
    <dc:creator>alice</dc:creator>
  </item>
  <item rdf:about="https://example.com/b">
    <title>RDF 条目 B</title>
    <dc:date>2026-10-02</dc:date>
  </item>
</rdf:RDF>`

/** summary / publishedAt / author / guid 四个字段的优先级候选一次性放齐 */
const FX_PRIORITY = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Priority</title>
    <link>https://example.com/</link>
    <description>频道摘要</description>
    <item>
      <title>有 description</title>
      <link>https://example.com/1</link>
      <description>来自 description</description>
      <summary>来自 summary</summary>
      <content:encoded><![CDATA[<p>来自 content:encoded</p>]]></content:encoded>
      <content>来自 content</content>
      <pubDate>Sat, 12 Oct 2026 08:00:00</pubDate>
      <dc:date>2026-01-01T00:00:00Z</dc:date>
      <author>来自 author</author>
      <dc:creator>来自 dc:creator</dc:creator>
      <itunes:author>来自 itunes:author</itunes:author>
      <guid>来自 guid</guid>
      <id>来自 id</id>
    </item>
    <item>
      <title>只有 content:encoded</title>
      <link>https://example.com/2</link>
      <content:encoded><![CDATA[<p>正文 <b>加粗</b></p>]]></content:encoded>
    </item>
    <item>
      <title>只有 summary 与 content</title>
      <link>https://example.com/3</link>
      <summary>summary 文本</summary>
      <content><![CDATA[content 文本]]></content>
    </item>
    <item>
      <title>只有 content</title>
      <link>https://example.com/4</link>
      <content><![CDATA[<p>content only</p>]]></content>
    </item>
    <item>
      <title>作者与标识回退</title>
      <link>https://example.com/5</link>
      <itunes:author>播客作者</itunes:author>
      <id>tag:example.com,2026:5</id>
      <updated>2026-03-04T05:06:07Z</updated>
    </item>
    <item>
      <title>日期不可解析</title>
      <link>https://example.com/6</link>
      <pubDate>不是日期</pubDate>
    </item>
  </channel>
</rss>`

/** 封面优先级：enclosure(image) > media:content > media:thumbnail > itunes:image > 正文 img */
const FX_IMAGE = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Images</title>
    <link>https://example.com/</link>
    <item>
      <title>enclosure 图片</title>
      <link>https://example.com/1</link>
      <enclosure url="/img/cover.png" type="image/png" length="0"/>
    </item>
    <item>
      <title>视频 enclosure 要被跳过</title>
      <link>https://example.com/2</link>
      <enclosure url="https://example.com/video.mp4" type="video/mp4"/>
      <media:content url="https://example.com/media.jpg" type="image/jpeg"/>
    </item>
    <item>
      <title>media:thumbnail</title>
      <link>https://example.com/3</link>
      <media:thumbnail url="thumb.jpg" width="480" height="360"/>
    </item>
    <item>
      <title>itunes:image</title>
      <link>https://example.com/4</link>
      <itunes:image href="https://example.com/itunes.jpg"/>
    </item>
    <item>
      <title>正文里的 img</title>
      <link>https://example.com/5</link>
      <description>&lt;p&gt;正文&lt;img src="rel/pic.png" alt="x"&gt;&lt;/p&gt;</description>
    </item>
    <item>
      <title>没有任何图</title>
      <link>https://example.com/6</link>
      <description>纯文本</description>
    </item>
  </channel>
</rss>`

/** itunes:duration 与 media:content duration 属性 */
const FX_DURATION = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Durations</title>
    <link>https://example.com/</link>
    <item>
      <title>itunes:duration 优先</title>
      <link>https://example.com/1</link>
      <itunes:duration>12:34</itunes:duration>
      <media:content url="https://example.com/a.mp3" duration="754"/>
    </item>
    <item>
      <title>media:content duration 属性</title>
      <link>https://example.com/2</link>
      <media:content url="https://example.com/b.mp3" duration="754"/>
    </item>
    <item>
      <title>没有时长</title>
      <link>https://example.com/3</link>
    </item>
  </channel>
</rss>`

/** 命名空间前缀无关 + 大小写无关 + 单引号 + 自闭合 */
const FX_LOOSE = `<?xml version='1.0' encoding='utf-8'?>
<RSS version='2.0' xmlns:ANY='http://example.com/ns'>
  <CHANNEL>
    <TITLE>大小写与引号</TITLE>
    <LINK>https://example.com/</LINK>
    <ITEM>
      <TITLE>单引号属性</TITLE>
      <LINK>https://example.com/x</LINK>
      <guid isPermaLink='false'>gid-1</guid>
      <enclosure url='https://example.com/a.png' type='image/png'/>
      <dc:date xmlns:dc='http://purl.org/dc/elements/1.1/'>2026-07-08T09:10:11Z</dc:date>
      <ANY:creator>前缀无关作者</ANY:creator>
    </ITEM>
    <ITEM>
      <TITLE>自闭合 link</TITLE>
      <LINK href="https://example.com/y"/>
      <date>2026-08-09</date>
    </ITEM>
  </CHANNEL>
</RSS>`

/** 实体：只解一层、CDATA 原样、非 CDATA 解码一次 */
const FX_ENTITIES = `<rss version="2.0">
  <channel>
    <title>实体</title>
    <link>https://example.com/</link>
    <item>
      <title>a &amp;lt; b</title>
      <link>https://example.com/1</link>
      <description>&amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt; &amp;amp; end</description>
    </item>
    <item>
      <title>a &lt;b&gt;b</title>
      <link>https://example.com/2</link>
      <description>&lt;b&gt;bold&lt;/b&gt; 与 &#39;引号&#39; 与 &#x27;x&#x27;</description>
    </item>
    <item>
      <title><![CDATA[原样 &amp;lt; 与 ]]>&amp;amp;<![CDATA[ 拼接]]></title>
      <link><![CDATA[https://example.com/3?x=1&amp;y=2]]></link>
      <description><![CDATA[&amp;lt;]]></description>
    </item>
    <item>
      <title>&#8211; &#x4E2D;&#25991; &unknownent; 100% & 50%</title>
      <link>https://example.com/4</link>
    </item>
  </channel>
</rss>`

/**
 * RSSHub YouTube 路由在拿到时长信息时输出的形态：`media:thumbnail` + `itunes:duration`。
 * 说明：2026-10-12 实测快照（FX_YOUTUBE）里**没有**这两个标签，所以这里按同一路由的
 * 真实输出结构手写补一条，专门钉住「media:thumbnail / itunes:duration 提取」。
 */
const FX_YOUTUBE_NS = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel><title>Two Minute Papers - YouTube</title><link>https://www.youtube.com/channel/UCbfYPyITQ-7l4upoX8nvctg</link><description>What a time to be alive! - Powered by RSSHub</description><item><title>With Thumbnail</title><link>https://www.youtube.com/watch?v=abcd1234</link><guid isPermaLink="false">https://www.youtube.com/watch?v=abcd1234</guid><pubDate>Wed, 07 Oct 2026 16:45:57 GMT</pubDate><media:thumbnail url="https://i.ytimg.com/vi/abcd1234/hqdefault.jpg" width="480" height="360"/><itunes:duration>12:34</itunes:duration><description>&lt;iframe src=&quot;https://www.youtube-nocookie.com/embed/abcd1234&quot;&gt;&lt;/iframe&gt;</description></item><item><title>With Duration Attribute</title><link>https://www.youtube.com/watch?v=efgh5678</link><guid isPermaLink="false">https://www.youtube.com/watch?v=efgh5678</guid><media:content url="https://i.ytimg.com/vi/efgh5678/hqdefault.jpg" duration="754"/><dc:creator>Two Minute Papers</dc:creator></item></channel></rss>`

/* ================================================================== *
 * 1. 三种格式
 * ================================================================== */

test('R01 · RSS 2.0 真实样本（少数派 / sspai.com/feed）', () => {
  const feed = parseFeed(FX_SSPAI, 'https://sspai.com/feed')
  assert.equal(feed.title, '少数派')
  assert.equal(feed.link, 'https://sspai.com')
  assert.match(feed.description ?? '', /^少数派致力于/)
  assert.equal(feed.items.length, 2)

  const first = feed.items[0]
  assert.equal(first.title, '写给「跑两步就喘」的你：不能忽略的跑后拉伸与恢复')
  assert.equal(first.link, 'https://sspai.com/post/115568')
  assert.equal(first.author, '阿帅的健康笔记')
  assert.equal(first.publishedAt, '2026-10-11T07:00:49.000Z')
  // 摘要是被实体转义的 HTML，必须已经剥干净
  assert.ok(first.summary?.includes('查看全文'), 'summary 应保留可见文案')
  assert.ok(!first.summary?.includes('<a '), 'summary 不应残留 <a 标签')
  assert.ok(!first.summary?.includes('&lt;'), 'summary 不应残留转义实体')
})

test('R02 · RSS 2.0 真实样本（Solidot，CDATA 标题/链接）', () => {
  const feed = parseFeed(FX_SOLIDOT, 'https://www.solidot.org/index.rss')
  // 频道标题里的 &#8211; 必须解成 en dash
  assert.equal(feed.title, '奇客Solidot\u2013传递最新科技情报')
  assert.equal(feed.link, 'https://www.solidot.org')
  assert.equal(feed.items.length, 2)

  const first = feed.items[0]
  assert.equal(first.title, '英国水果蔬菜营养价值下降最高五成') // 来自 <![CDATA[…]]>
  assert.equal(first.link, 'https://www.solidot.org/story?sid=85580') // link 也是 CDATA
  assert.equal(first.publishedAt, '2026-10-11T14:27:04.000Z')
  assert.equal(first.author, undefined) // Solidot 不提供作者
  assert.ok(first.summary?.endsWith('。'))
  assert.ok(!first.summary?.includes('</p>'), 'CDATA 里的 <p></p> 应被剥掉')
})

test('R03 · Atom 1.0 真实样本（阮一峰，含 rel="self"）', () => {
  const feed = parseFeed(FX_RUANYIFENG, 'https://www.ruanyifeng.com/blog/atom.xml')
  assert.equal(feed.title, '阮一峰的网络日志')
  // feed 级链接必须取 rel="alternate"，不能取 rel="self" 的 atom.xml
  assert.equal(feed.link, 'http://www.ruanyifeng.com/blog/')
  assert.ok(!feed.link?.includes('atom.xml'))
  // Atom 的 <subtitle> 视作 description，&apos; 要解码
  assert.equal(feed.description, "Ruan YiFeng's Blog")
  assert.equal(feed.items.length, 2)

  const first = feed.items[0]
  assert.equal(first.title, '科技爱好者周刊（第 414 期）：Jev 决策模型有什么用')
  assert.equal(first.link, 'http://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html')
  assert.ok(!first.link.includes('atom.xml'), 'entry 链接不能是 rel="self" 的 href')
  assert.equal(first.author, '阮一峰') // <author><name>
  assert.equal(first.guid, 'tag:www.ruanyifeng.com,2026:/blog//1.2558')
  // <published> 优先于 <updated>（后者是 2026-10-11）
  assert.equal(first.publishedAt, '2026-10-08T15:04:46.000Z')
  // 封面来自 content 里那段 CDATA 的 <img>
  assert.equal(first.image, 'https://cdn.beekka.com/blogimg/asset/202610/bg2026100816.webp')
  assert.equal(feed.items[1].image, 'https://cdn.beekka.com/blogimg/asset/202609/bg2026091701.webp')
})

test('R04 · Atom 1.0 + 命名空间真实样本（arXiv API）', () => {
  const feed = parseFeed(
    FX_ARXIV,
    'https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&max_results=3',
  )
  assert.equal(feed.items.length, 3)
  assert.match(feed.title ?? '', /^arXiv Query/)

  const first = feed.items[0]
  assert.match(first.title, /METR plot$/)
  // 必须是 rel="alternate"（abs），不能是 rel="related"（pdf）
  assert.equal(first.link, 'https://arxiv.org/abs/2610.12466v1')
  assert.ok(!first.link.includes('pdf'), '不能取 rel="related" 的 pdf 链接')
  assert.equal(first.guid, 'http://arxiv.org/abs/2610.12466v1')
  assert.equal(first.author, 'Drew T. Nguyen')
  assert.equal(first.publishedAt, '2026-10-08T17:59:50.000Z') // 来自 <updated>
  assert.ok(first.summary?.includes('METR'), 'Atom <summary> 应被采用')
})

test('R05 · RSS 1.0 / RDF（item 与 channel 平级）', () => {
  const feed = parseFeed(FX_RDF)
  assert.equal(feed.title, '示例 RDF 频道')
  assert.equal(feed.link, 'https://example.com/')
  assert.equal(feed.description, 'RDF 摘要')
  assert.equal(feed.items.length, 2)

  const a = feed.items[0]
  assert.equal(a.title, 'RDF 条目 A')
  assert.equal(a.link, 'https://example.com/a')
  assert.equal(a.author, 'alice') // dc:creator
  assert.equal(a.guid, 'https://example.com/a') // rdf:about 兜底
  assert.equal(a.publishedAt, '2026-10-01T12:00:00.000Z') // dc:date

  const b = feed.items[1]
  assert.equal(b.title, 'RDF 条目 B')
  assert.equal(b.link, 'https://example.com/b') // 无 <link> → rdf:about 兜底
  assert.equal(b.guid, 'https://example.com/b')
  assert.equal(b.publishedAt, '2026-10-02T00:00:00.000Z')
})

/* ================================================================== *
 * 2/3. title 与 link
 * ================================================================== */

test('R06 · Atom 的 rel="self" / rel="replies" 绝不被当成正文链接', () => {
  const feed = parseFeed(FX_ATOM_SELF, FEED_BASE)
  // feed 级：alternate 胜出
  assert.equal(feed.link, 'https://example.com/')
  assert.ok(!feed.link?.includes('feed.xml'))

  // entry 级：self(?format=atom) 与 replies(comments) 都要跳过
  assert.equal(feed.items[0].link, 'https://example.com/entry/1')
  assert.ok(!feed.items[0].link.includes('format=atom'))
  assert.ok(!feed.items[0].link.includes('comments'))
  // 无 rel 的 href 也要能用，并且相对地址要绝对化
  assert.equal(feed.items[1].link, 'https://example.com/entry/2')
  assert.equal(feed.items[0].guid, 'tag:example.com,2026:1')
  assert.equal(feed.items[0].publishedAt, '2026-05-01T00:00:00.000Z')
})

test('R07 · RSS 的 link 取文本、guid 取 guid/id/rdf:about', () => {
  const feed = parseFeed(FX_PRIORITY)
  assert.equal(feed.items[0].link, 'https://example.com/1')
  assert.equal(feed.items[0].guid, '来自 guid') // guid 优先于 id
  assert.equal(feed.items[4].guid, 'tag:example.com,2026:5') // 无 guid → id
})

/* ================================================================== *
 * 4. summary 优先级
 * ================================================================== */

test('R08 · summary 优先级 description > summary > content:encoded > content', () => {
  const items = parseFeed(FX_PRIORITY).items
  assert.equal(items[0].summary, '来自 description')
  assert.equal(items[1].summary, '正文 加粗') // content:encoded，CDATA 里的标签已剥
  assert.equal(items[2].summary, 'summary 文本') // summary 优先于 content
  assert.equal(items[3].summary, 'content only')
  assert.equal(items[5].summary, undefined) // 完全没有正文
})

/* ================================================================== *
 * 5. publishedAt
 * ================================================================== */

test('R09 · publishedAt 优先级 pubDate > published > updated > dc:date > date', () => {
  const items = parseFeed(FX_PRIORITY).items
  // pubDate 胜出；且没有时区信息时按本地时间处理，不能是 Invalid Date
  const noTz = items[0].publishedAt
  assert.ok(noTz !== undefined && !Number.isNaN(Date.parse(noTz)), '无时区的 pubDate 也要能解析')
  assert.equal(new Date(noTz).getHours(), 8)
  assert.equal(new Date(noTz).getDate(), 12)
  // 无 pubDate/published 时回退 updated
  assert.equal(items[4].publishedAt, '2026-03-04T05:06:07.000Z')
  // 无法解析 → undefined（不是 "Invalid Date"）
  assert.equal(items[5].publishedAt, undefined)
})

test('R10 · 日期为纯日期串 / 非法串的降级', () => {
  const rdf = parseFeed(FX_RDF).items
  assert.equal(rdf[1].publishedAt, '2026-10-02T00:00:00.000Z') // 纯日期按 UTC 零点
  const loose = parseFeed(FX_LOOSE).items
  assert.equal(loose[1].publishedAt, '2026-08-09T00:00:00.000Z') // <date> 命名空间前缀无关
  const broken = parseFeed(
    '<rss><channel><item><title>t</title><link>https://e.com/1</link><pubDate>not a date</pubDate></item></channel></rss>',
  )
  assert.equal(broken.items[0].publishedAt, undefined)
  assert.equal(JSON.stringify(broken).includes('Invalid Date'), false)
})

/* ================================================================== *
 * 6. author
 * ================================================================== */

test('R11 · author 优先级 author / dc:creator / itunes:author，Atom 取 <name>', () => {
  const items = parseFeed(FX_PRIORITY).items
  assert.equal(items[0].author, '来自 author') // 三者同时存在，author 胜出
  assert.equal(items[4].author, '播客作者') // 只有 itunes:author
  assert.equal(parseFeed(FX_RDF).items[0].author, 'alice') // dc:creator
  assert.equal(parseFeed(FX_ATOM_SELF, FEED_BASE).items[0].author, undefined)
})

/* ================================================================== *
 * 7. guid
 * ================================================================== */

test('R12 · guid 在三种格式下都能拿到', () => {
  const yt = parseFeed(FX_YOUTUBE, 'https://rsshub.ktachibana.party/youtube/channel/UCbfYPyITQ-7l4upoX8nvctg')
  assert.equal(yt.items[0].guid, 'https://www.youtube.com/watch?v=Wkaw03p3BrM')
  assert.equal(parseFeed(FX_LOOSE).items[0].guid, 'gid-1') // 单引号属性 isPermaLink='false'
  assert.equal(parseFeed(FX_RDF).items[0].guid, 'https://example.com/a') // rdf:about
})

/* ================================================================== *
 * 8. image
 * ================================================================== */

test('R13 · image 优先级 enclosure(image/*) > media:content > media:thumbnail > itunes:image > 正文 img', () => {
  const items = parseFeed(FX_IMAGE, FEED_BASE).items
  assert.equal(items[0].image, 'https://example.com/img/cover.png') // 相对地址已绝对化
  assert.equal(items[1].image, 'https://example.com/media.jpg') // video enclosure 被跳过
  assert.equal(items[2].image, 'https://example.com/thumb.jpg') // media:thumbnail
  assert.equal(items[3].image, 'https://example.com/itunes.jpg') // itunes:image
  assert.equal(items[4].image, 'https://example.com/rel/pic.png') // 转义 HTML 里的 <img src>
  assert.equal(items[5].image, undefined)
})

test('R14 · 真实样本里的封面提取（IT之家转义 img / 阮一峰 CDATA img）', () => {
  const ithome = parseFeed(FX_ITHOME, 'https://www.ithome.com/rss/').items[0]
  assert.equal(
    ithome.image,
    'https://img.ithome.com/newsuploadfiles/2026/10/13b80987-aa94-4f25-a2a3-ee4b9c5c04ef.png?x-bce-process=image/format,f_auto',
  )
  const ruanyifeng = parseFeed(FX_RUANYIFENG, 'https://www.ruanyifeng.com/blog/atom.xml').items[0]
  assert.match(ruanyifeng.image, /^https:\/\/cdn\.beekka\.com\/blogimg\//)
})

/* ================================================================== *
 * 8bis. duration
 * ================================================================== */

test('R15 · duration 来自 itunes:duration 或 media:content 的 duration 属性', () => {
  const items = parseFeed(FX_DURATION, FEED_BASE).items
  assert.equal(items[0].duration, '12:34') // itunes:duration 优先
  assert.equal(items[1].duration, '754') // media:content duration="754"
  assert.equal(items[2].duration, undefined)
  const yt = parseFeed(FX_YOUTUBE_NS, 'https://rsshub.ktachibana.party/youtube/channel/UCbfYPyITQ-7l4upoX8nvctg')
  assert.equal(yt.items[0].duration, '12:34')
  assert.equal(yt.items[0].image, 'https://i.ytimg.com/vi/abcd1234/hqdefault.jpg') // media:thumbnail
  assert.equal(yt.items[1].duration, '754')
  assert.equal(yt.items[1].image, 'https://i.ytimg.com/vi/efgh5678/hqdefault.jpg') // media:content url
  assert.equal(yt.items[1].author, 'Two Minute Papers') // dc:creator
})

/* ================================================================== *
 * 9. 实体解码
 * ================================================================== */

test('R16 · 实体解码：命名 / 十进制 / 十六进制，且只解一层', () => {
  assert.equal(cleanText('&amp; &lt; &gt; &quot; &apos;'), '& < > " \'')
  assert.equal(cleanText('&#39;'), "'")
  assert.equal(cleanText('&#x27;'), "'")
  assert.equal(cleanText('&#8211;'), '\u2013')
  assert.equal(cleanText('&#x4E2D;'), '\u4e2d')
  assert.equal(cleanText('&amp;lt;'), '&lt;') // 不是 '<'
  assert.equal(cleanText('&amp;amp;'), '&amp;')
  assert.equal(cleanText('&unknownent;'), '&unknownent;') // 未收录 → 原样
  assert.equal(cleanText('100% & 50%'), '100% & 50%') // 裸 & 不动
  assert.equal(cleanText('&#xZZ;'), '&#xZZ;') // 非法码点 → 原样
})

test('R17 · parseFeed 层：CDATA 先取出、再解码一次（不二次解码）', () => {
  const items = parseFeed(FX_ENTITIES).items
  assert.equal(items[0].title, 'a &lt; b') // &amp;lt; → &lt;
  assert.equal(items[0].summary, '&lt;b&gt;bold&lt;/b&gt; &amp; end') // 只解一层，不会复活成标签
  assert.equal(items[1].title, 'a <b>b') // &lt;b&gt; → <b>
  assert.equal(items[1].summary, "bold 与 '引号' 与 'x'") // 解码一次后再剥标签
  assert.equal(items[2].title, '原样 &lt; 与 &amp; 拼接') // CDATA 与普通文本混排
  assert.equal(items[2].link, 'https://example.com/3?x=1&y=2') // CDATA 里的 &amp; 解一次
  assert.equal(items[2].summary, '&lt;') // 整段 CDATA 只解一层
  assert.equal(items[3].title, '\u2013 \u4e2d\u6587 &unknownent; 100% & 50%')
})

/* ================================================================== *
 * 10/11. 命名空间、大小写、引号、自闭合
 * ================================================================== */

test('R18 · 命名空间前缀无关（media:content↔content、dc:date↔date、itunes:author↔author）', () => {
  const ns = parseFeed(
    `<rss version="2.0"><channel><item>
       <title>无前缀</title><link>https://e.com/1</link>
       <content url="https://e.com/plain-content.png"/>
       <date>2026-09-09T09:09:09Z</date>
       <author>无前缀作者</author>
     </item></channel></rss>`,
  ).items[0]
  assert.equal(ns.image, 'https://e.com/plain-content.png') // <content url> 与 media:content 等价
  assert.equal(ns.publishedAt, '2026-09-09T09:09:09.000Z') // <date> 与 dc:date 等价
  assert.equal(ns.author, '无前缀作者')
  assert.equal(parseFeed(FX_LOOSE).items[0].author, '前缀无关作者') // <ANY:creator>
})

test('R19 · 大小写不一致 / 单引号属性 / 自闭合标签都能处理', () => {
  const feed = parseFeed(FX_LOOSE, FEED_BASE)
  assert.equal(feed.title, '大小写与引号') // <TITLE> / <RSS> / <CHANNEL>
  assert.equal(feed.items.length, 2)
  assert.equal(feed.items[0].title, '单引号属性')
  assert.equal(feed.items[0].link, 'https://example.com/x')
  assert.equal(feed.items[0].image, 'https://example.com/a.png') // <enclosure … /> 自闭合
  assert.equal(feed.items[1].link, 'https://example.com/y') // <LINK href="…"/> 无 rel
  assert.equal(feed.items[0].publishedAt, '2026-07-08T09:10:11.000Z')
})

test('R20 · 属性里的实体会被解码，且只解一次', () => {
  const feed = parseFeed(
    `<rss version="2.0"><channel>
      <item><title>a</title><link href="https://e.com/a?x=1&amp;y=2&amp;amp;z=3"/></item>
      <item><title>b</title><enclosure url="https://e.com/i.png?a=1&amp;b=2" type="image/png"/></item>
    </channel></rss>`,
  )
  assert.equal(feed.items[0].link, 'https://e.com/a?x=1&y=2&amp;z=3')
  assert.equal(feed.items[1].image, 'https://e.com/i.png?a=1&b=2')
})

/* ================================================================== *
 * 12. 降级：空 / 畸形 / HTML
 * ================================================================== */

test('R21 · 空、畸形、HTML 输入 → { items: [] } 且绝不抛异常', () => {
  const cases = [
    '',
    '   ',
    'not xml at all',
    'plain text with < and > and &',
    '<!DOCTYPE html><html><head><title>hi</title></head><body><p>a < b</p></body></html>',
    '<html><body><h1>HTML 不是 feed</h1></body></html>',
    '<!-- 只有注释 -->',
    '<?xml version="1.0"?>',
    '<rss></rss>',
    '<feed xmlns="http://www.w3.org/2005/Atom"></feed>',
    '<unknown><root/></unknown>',
    '{}',
    '<rss><channel><item></item></channel></rss>',
  ]
  for (const input of cases) {
    let feed
    assert.doesNotThrow(() => {
      feed = parseFeed(input)
    }, `不应抛异常：${JSON.stringify(input.slice(0, 40))}`)
    assert.ok(Array.isArray(feed.items), 'items 必须是数组')
  }
  assert.deepEqual(parseFeed('not xml at all'), { items: [] })
  assert.deepEqual(parseFeed('<html><body>x</body></html>'), { items: [] })
})

test('R22 · 截断 / 未闭合文档降级返回已解析到的部分', () => {
  const truncated = parseFeed('<rss version="2.0"><channel><title>半个文档')
  assert.equal(truncated.title, '半个文档')
  assert.deepEqual(truncated.items, [])

  const unclosedItem = parseFeed('<rss><channel><item><title>unclosed')
  assert.equal(unclosedItem.items.length, 1)
  assert.equal(unclosedItem.items[0].title, 'unclosed')
  assert.equal(unclosedItem.items[0].link, '')

  const emptyItem = parseFeed('<rss><channel><item><title></title><link></link></item></channel></rss>')
  assert.equal(emptyItem.items[0].title, '')
  assert.equal(emptyItem.items[0].link, '')
  // 可选字段不允许出现 undefined 值（exactOptionalPropertyTypes 友好）
  assert.equal('summary' in emptyItem.items[0], false)
})

test('R23 · 前置声明 / 注释 / DOCTYPE 内部子集不影响解析', () => {
  const withProlog = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE rss [
  <!ENTITY foo "bar">
]>
<!-- 这是注释，里面有 <item> 和 </channel> -->
<rss version="2.0"><channel><title>Prolog</title>
  <item><title>真正的一条</title><link>https://example.com/real</link></item>
</channel></rss>`
  const feed = parseFeed(withProlog)
  assert.equal(feed.title, 'Prolog')
  assert.equal(feed.items.length, 1)
  assert.equal(feed.items[0].title, '真正的一条')
})

/* ================================================================== *
 * 工具函数
 * ================================================================== */

test('R24 · cleanText：剥标签、压缩空白、容错', () => {
  assert.equal(cleanText(undefined), '')
  assert.equal(cleanText(''), '')
  assert.equal(cleanText('<p>a</p><p>b</p>'), 'a b')
  assert.equal(cleanText('a<br>b'), 'a b')
  assert.equal(cleanText('  a\n\n\t b  '), 'a b')
  assert.equal(cleanText('&nbsp;a&nbsp;'), 'a')
  assert.equal(cleanText('<script>var a = 1 < 2;</script>正文'), '正文')
  assert.equal(cleanText('<style>.a{color:red}</style>正文'), '正文')
  assert.equal(cleanText('a < b'), 'a < b') // 裸 '<' 不是标签
  assert.equal(cleanText('<a href="x>y">链接</a>'), '链接') // 属性里的 '>' 不能截断标签
  assert.equal(cleanText('<!-- 注释 -->结果'), '结果')
  assert.equal(cleanText('<![CDATA[原样文本]]>'), '原样文本')
})

test('R25 · absoluteUrl：相对转绝对、失败原样返回', () => {
  assert.equal(absoluteUrl('https://a.com/x', 'https://b.com/'), 'https://a.com/x')
  assert.equal(absoluteUrl('https://a.com', 'https://b.com/'), 'https://a.com') // 不做归一化改写
  assert.equal(absoluteUrl('/p', 'https://a.com/blog/feed.xml'), 'https://a.com/p')
  assert.equal(absoluteUrl('p/q.png', 'https://a.com/blog/feed.xml'), 'https://a.com/blog/p/q.png')
  assert.equal(absoluteUrl('../up.png', 'https://a.com/blog/feed.xml'), 'https://a.com/up.png')
  assert.equal(absoluteUrl('//cdn.a.com/x.png', 'https://a.com/feed'), 'https://cdn.a.com/x.png')
  assert.equal(absoluteUrl('/p'), '/p') // 没有 base → 原样
  assert.equal(absoluteUrl('/p', 'not a url'), '/p')
  assert.equal(absoluteUrl(''), '')
  assert.equal(absoluteUrl('  https://a.com/x  '), 'https://a.com/x')
  assert.equal(absoluteUrl('mailto:a@b.com'), 'mailto:a@b.com')
  assert.equal(absoluteUrl('第 1 期.html', 'https://a.com/blog/'), 'https://a.com/blog/%E7%AC%AC%201%20%E6%9C%9F.html')
})

/* ================================================================== *
 * 健壮性 / 性能（防回溯炸弹、防空转）
 * ================================================================== */

test('R26 · 超深嵌套不炸栈（深度上限降级）', () => {
  const deep =
    '<rss><channel><item><title>deep</title><link>https://e.com/deep</link></item>' +
    '<a>'.repeat(5000) +
    'x' +
    '</a>'.repeat(5000) +
    '</channel></rss>'
  let feed
  assert.doesNotThrow(() => {
    feed = parseFeed(deep)
  })
  assert.equal(feed.items.length, 1)
  assert.equal(feed.items[0].title, 'deep')
})

test('R27 · 大输入线性处理（大量裸 & / 大量标签），不空转不炸', () => {
  const started = Date.now()

  // 5 万个裸 '&'：找 ';' 的扫描必须有长度上限，否则是 O(n²)
  const amps = parseFeed(`<rss><channel><item><title>${'&'.repeat(50000)}</title></item></channel></rss>`)
  assert.equal(amps.items[0].title, '&'.repeat(50000))

  // 16 万个字符的 CDATA 标签汤
  const soup = parseFeed(
    `<rss><channel><item><title>t</title><description><![CDATA[${'<p>x</p>'.repeat(20000)}]]></description></item></channel></rss>`,
  )
  assert.equal(soup.items.length, 1)
  assert.equal(soup.items[0].summary, 'x '.repeat(20000).trim())

  // 畸形：大量 '<' 但没有 '>'（不能把扫描器拖死）
  const noClose = parseFeed(`<rss><channel><item><title>${'<a'.repeat(50000)}</title></item></channel></rss>`)
  assert.equal(noClose.items.length, 1)

  const elapsed = Date.now() - started
  assert.ok(elapsed < 5000, `解析耗时 ${elapsed}ms，超过 5s 预期`)
})

/* ================================================================== *
 * 真实 YouTube / RSSHub 快照
 * ================================================================== */

test('R28 · RSSHub 镜像 YouTube 真实快照（实体、guid、text/html enclosure）', () => {
  const URL = 'https://rsshub.ktachibana.party/youtube/channel/UCbfYPyITQ-7l4upoX8nvctg'
  const feed = parseFeed(FX_YOUTUBE, URL)
  assert.equal(feed.title, 'Two Minute Papers - YouTube')
  assert.equal(feed.link, 'https://www.youtube.com/channel/UCbfYPyITQ-7l4upoX8nvctg')
  assert.equal(feed.description, 'What a time to be alive! - Powered by RSSHub')
  assert.equal(feed.items.length, 2)

  const first = feed.items[0]
  assert.equal(first.title, "DeepMind's New AI Just Cracked The Code Of Life") // &#39; 已解码
  assert.equal(first.link, 'https://www.youtube.com/watch?v=Wkaw03p3BrM')
  assert.equal(first.guid, 'https://www.youtube.com/watch?v=Wkaw03p3BrM')
  assert.equal(first.publishedAt, '2026-10-07T16:45:57.000Z')
  // 这条 enclosure 是 type="text/html"，绝不能当作封面图
  assert.equal(first.image, undefined)
  // description 只有一个 iframe，剥完标签后为空 → summary 省略
  assert.equal(first.summary, undefined)
  assert.ok(!('image' in first))
})

