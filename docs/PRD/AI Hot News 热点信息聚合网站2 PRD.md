AI Hot News PRD

AI 热点信息聚合与关键词监控平台

⸻

1. 项目背景

AI 时代信息迭代非常快，新模型、新工具、新产品、新论文、新开源项目、融资信息和行业观点每天都在持续出现。

目前获取 AI 热点信息主要依赖人工刷信息流，比如 Twitter / X、RSS、HackerNews、Reddit 等平台。但这种方式存在明显问题：

1. 信息源分散
    热点内容分布在不同平台，需要频繁切换查看。
2. 信息噪音高
    平台上存在大量重复内容、营销内容、无效讨论，需要人工筛选。
3. 热点发现滞后
    依赖手动刷信息，很容易错过热点爆发的早期阶段。
4. 关键词监控不系统
    用户虽然知道自己关注某些方向，但很难持续监控关键词变化。
5. 不知道该监控什么词
    很多热点词、新产品名、新概念在爆发前用户并不知道，完全依赖用户输入关键词会有局限。
6. 缺少长期沉淀
    信息看完即过，无法形成趋势数据、竞品动态和历史搜索库。

因此，希望建设一个 AI Hot News 热点信息聚合网站，自动从主流平台聚合 AI 热点内容，并支持关键词监控、智能关键词推荐、AI 摘要和热点趋势分析。

⸻

2. 产品定位

2.1 一句话定位

AI Hot News 是一个以 Twitter / X 为核心信息源，结合 RSS、HackerNews、Reddit 等平台的 AI 热点聚合与关键词监控平台，帮助用户第一时间发现 AI 行业热点、技术趋势和竞品动态。

⸻

2.2 产品关键词

* AI 热点聚合
* Twitter / X 监控
* RSS 聚合
* HackerNews 技术讨论
* Reddit 社区观点
* 关键词监控
* 智能关键词推荐
* AI 摘要
* 趋势分析
* 行业情报
* 竞品监控
* 自动推送

⸻

3. 产品目标

3.1 核心目标

1. 自动聚合 AI 热点信息
    从 Twitter / X、RSS、HackerNews、Reddit 等平台抓取 AI 相关内容。
2. 优先接入 Twitter / X
    因为 Twitter / X 是用户平时高频刷的平台，也是 AI 热点爆发最快的信息源。
3. 支持关键词监控
    用户可以输入关键词，系统持续监控相关动态。
4. 支持智能关键词推荐
    当用户不知道该输入什么关键词时，系统可以根据热点趋势主动推荐值得关注的词。
5. AI 摘要与分类
    对抓取内容自动生成摘要、标签和热点归类。
6. 热点排序与趋势分析
    根据互动量、发布时间、来源权重、增长速度等计算热度。
7. 及时推送
    当关键词或热点达到触发条件时，自动通知用户。
8. 形成长期内容库
    将热点信息沉淀为可搜索、可回溯、可分析的数据资产。

⸻

4. 目标用户

4.1 核心用户

用户类型	核心需求
AI 产品经理	快速了解行业趋势、竞品动态、新功能方向
AI 开发者	关注新模型、开源项目、技术文章、开发工具
内容创作者	获取选题灵感，追踪热门话题
投资 / 研究人员	观察公司动态、融资信息和技术趋势
运营 / 增长人员	捕捉热点，用于内容策划和营销传播
创业者	判断 AI 赛道变化，发现产品机会
独立开发者	发现新工具、新需求和潜在产品方向

⸻

4.2 用户场景

场景一：每日浏览 AI 热点

用户每天早上打开网站，查看过去 24 小时 AI 圈最值得关注的信息。

⸻

场景二：监控指定关键词

用户输入：

Claude Code
Cursor
OpenAI
AI Agent
MCP

系统持续从 Twitter / X、RSS、HN、Reddit 检索相关内容。

⸻

场景三：不知道该关注什么词

用户不知道应该输入哪些关键词，系统推荐：

今日快速上升：
- MCP
- Vibe Coding
- Agentic Coding
- OpenAI Agents SDK
- Local LLM

用户可以一键加入监控。

⸻

场景四：竞品监控

用户关注 AI 修图 / 影像工具方向，系统持续监控：

Evoto
Lightroom AI
Photoshop AI
Canva AI
Runway
Remini
Picsart

⸻

场景五：热点爆发提醒

某个关键词在短时间内被多个 Twitter / X 大 V 提及，或者同时出现在 HackerNews 和 Reddit，系统自动推送提醒。

⸻

5. 产品核心能力

AI Hot News 包含 6 个核心能力：

1. 多平台热点聚合
2. Twitter / X 核心监控
3. 关键词监控
4. 智能关键词推荐
5. AI 摘要与标签分类
6. 热点趋势分析与推送

⸻

6. 信息源设计

6.1 数据源优先级

优先级	数据源	说明
P0	Twitter / X	AI 热点爆发最快，用户高频使用，必须优先接入
P0	RSS	稳定、低成本，适合官方博客和媒体源
P1	HackerNews	技术讨论质量高，适合发现开发者关注内容
P1	Reddit	社区讨论丰富，适合补充用户反馈和长尾观点
P2	GitHub	后续用于发现开源项目趋势
P2	Product Hunt	后续用于发现新产品发布
P2	arXiv	后续用于发现 AI 论文趋势
P2	YouTube	后续用于监控 AI 视频内容

⸻

7. 功能需求

⸻

7.1 热点信息聚合

7.1.1 功能说明

系统定时从多个主流平台抓取 AI 相关内容，经过清洗、去重、摘要、分类和热度计算后，统一展示在网站中。

⸻

7.1.2 支持平台

平台	信息类型	示例
Twitter / X	推文、账号动态、关键词搜索结果	OpenAI 发布新模型、AI 工具讨论
RSS	官方博客、媒体文章、技术博客	OpenAI Blog、Anthropic News、Google AI Blog
HackerNews	热门技术讨论	Show HN、Ask HN、AI 工具讨论
Reddit	社区帖子、评论讨论	r/LocalLLaMA、r/MachineLearning、r/artificial
GitHub	开源项目	Star 增长、Release、README 更新
Product Hunt	产品发布	新 AI 工具上线
arXiv	AI 论文	LLM、多模态、Agent 相关论文

⸻

7.1.3 抓取策略

1. 定时轮询不同平台数据。
2. 支持平台级别抓取频率配置。
3. 支持关键词级别抓取频率配置。
4. 对抓取结果进行清洗。
5. 对相同链接、相同标题、相似内容进行去重。
6. 对内容进行关键词匹配。
7. 对内容进行 AI 摘要和标签分类。
8. 根据热度算法计算综合分数。
9. 将高价值内容进入热点池。
10. 支持失败重试和抓取日志记录。

⸻

7.1.4 内容字段

字段	说明
标题	内容标题或自动生成标题
原始内容	推文正文、文章摘要、帖子内容
原始链接	跳转到原平台
来源平台	Twitter / RSS / HN / Reddit
作者 / 账号	内容发布者
发布时间	原始内容发布时间
抓取时间	系统抓取时间
互动数据	点赞、转发、评论、投票等
命中关键词	命中的关键词
AI 标签	模型、工具、Agent、开源、融资等
AI 摘要	自动生成摘要
热度分	系统计算的综合分数
内容状态	展示 / 隐藏 / 待审核

⸻

7.2 Twitter / X 核心监控

7.2.1 功能说明

Twitter / X 是本产品的 P0 核心数据源，需要优先支持关键词搜索、账号监控和热门推文识别。

⸻

7.2.2 X 关键词搜索

用户可以配置关键词，系统定时从 X 检索相关内容。

示例关键词

OpenAI
Claude Code
AI Agent
Cursor
Sora
Gemini
Local LLM
Vibe Coding
MCP
Evoto
AI Photo Editor

⸻

关键词配置项

配置项	说明
关键词	需要监控的核心词
同义词	例如 Claude Code / Anthropic Code
排除词	用于过滤无关内容
语言	英文 / 中文 / 日文等
监控频率	15 分钟 / 30 分钟 / 1 小时
最低热度阈值	点赞、转发、评论达到一定数量才入库
是否推送	命中后是否发送提醒
平台范围	可单独选择 Twitter / X 或多平台

⸻

7.2.3 X 指定账号监控

除了关键词搜索，还需要支持监控指定账号。

推荐账号类型

类型	示例
AI 公司官方账号	OpenAI、Anthropic、Google DeepMind、Meta AI、Perplexity
AI 产品账号	Cursor、Runway、Midjourney、Hugging Face
行业 KOL	Sam Altman、Andrej Karpathy、Yann LeCun
技术开发者	开源作者、Agent 工具作者、AI 工程师
竞品账号	和自身业务相关的 AI 工具、图像工具、修图工具账号

⸻

账号监控能力

1. 监控账号最新推文。
2. 获取推文互动数据。
3. 识别高互动推文。
4. 识别账号发布的产品更新、融资、模型发布等重大信息。
5. 支持监控转发内容。
6. 支持给不同账号配置权重。
7. 支持账号分组，例如：
    * AI 公司
    * AI 工具
    * AI KOL
    * 竞品
    * 开源作者

⸻

7.2.4 热门推文识别

X 上的信息不能只按发布时间展示，还需要识别“正在变热”的内容。

判断维度

维度	说明
点赞数	判断基础热度
转发数	判断传播能力
评论数	判断讨论强度
Quote 数	判断二次传播
浏览数	判断曝光规模
作者权重	官方账号、大 V、核心开发者权重更高
发布时间	越新的内容时间衰减越小
增长速度	短时间互动快速增长说明正在爆发
关键词命中	命中核心 AI 关键词加权
跨平台出现	同一事件在 HN / Reddit / RSS 出现时加权

⸻

7.2.5 X 内容数据结构

interface XPost {
  id: string;
  text: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  authorFollowers?: number;
  tweetUrl: string;
  publishedAt: string;
  crawledAt: string;
  metrics: {
    likeCount: number;
    repostCount: number;
    replyCount: number;
    quoteCount?: number;
    viewCount?: number;
  };
  matchedKeywords: string[];
  aiSummary: string;
  tags: string[];
  heatScore: number;
  language?: string;
}

⸻

7.3 RSS 聚合

7.3.1 功能说明

RSS 适合作为稳定信息源，用于监控官方博客、媒体文章、技术博客和公告内容。

⸻

7.3.2 推荐 RSS 源

类型	示例
AI 公司官方博客	OpenAI Blog、Anthropic News、Google AI Blog、DeepMind Blog
技术社区	Hugging Face Blog、LangChain Blog
科技媒体	TechCrunch AI、The Verge AI、VentureBeat AI
论文 / 研究	arXiv AI RSS
产品博客	Cursor Blog、Perplexity Blog、Runway Blog

⸻

7.3.3 RSS 功能要求

1. 支持添加 RSS 源。
2. 支持启用 / 停用 RSS 源。
3. 支持配置抓取频率。
4. 支持查看最近抓取状态。
5. 支持 RSS 内容自动摘要。
6. 支持 RSS 内容进入热点排序。
7. 支持 RSS 源分组管理。

⸻

7.4 HackerNews 接入

7.4.1 功能说明

HackerNews 适合发现开发者关注的 AI 工具、开源项目和技术讨论。

⸻

7.4.2 采集内容

1. 首页热门内容。
2. Show HN 内容。
3. Ask HN 内容。
4. 指定关键词搜索结果。
5. 评论区讨论摘要。

⸻

7.4.3 适合发现的内容

类型	示例
开源工具	新 AI 开源项目
技术争议	模型能力、成本、隐私讨论
开发者工具	Agent、IDE、代码助手
新产品发布	Show HN 类 AI 工具
技术深度讨论	LLM、RAG、推理模型、多模态

⸻

7.5 Reddit 接入

7.5.1 功能说明

Reddit 适合发现社区观点、用户反馈、模型体验和长尾讨论。

⸻

7.5.2 推荐 subreddit

r/LocalLLaMA
r/MachineLearning
r/artificial
r/OpenAI
r/ChatGPT
r/singularity
r/StableDiffusion
r/ClaudeAI

⸻

7.5.3 Reddit 功能要求

1. 支持指定 subreddit 监控。
2. 支持关键词搜索。
3. 支持热门帖抓取。
4. 支持评论区摘要。
5. 支持社区情绪判断。
6. 支持将 Reddit 内容纳入热点排序。

⸻

8. 关键词监控

8.1 功能说明

用户可以输入自己关注的关键词，系统持续从多个平台监控相关内容，并在达到规则时提醒用户。

⸻

8.2 关键词示例

OpenAI
ChatGPT
Claude Code
Gemini
Sora
AI Agent
Cursor
Devin
Vibe Coding
Local LLM
Stable Diffusion
AI Photo Editor
Evoto
Midjourney
MCP

⸻

8.3 关键词监控配置

配置项	说明
关键词	用户输入的监控词
同义词	相关词，如 Claude Code / Anthropic Code
排除词	过滤无关内容
来源平台	Twitter / X、RSS、HN、Reddit
监控频率	15分钟 / 30分钟 / 1小时 / 每天
触发条件	新内容出现 / 热度超过阈值 / 讨论量突然上升
推送方式	站内通知 / 邮件 / 飞书 / 钉钉 / Telegram
状态	启用 / 停用
语言	全部 / 英文 / 中文 / 日文
最低互动量	过滤低质量内容
优先级	高 / 中 / 低

⸻

8.4 监控规则示例

关键词：Claude Code
监控平台：
- Twitter / X
- HackerNews
- Reddit
频率：
30 分钟一次
触发条件：
1. 30 分钟内出现超过 10 条相关内容
2. 单条内容热度分超过 80
3. HackerNews 上榜
4. 被高权重账号提及
推送方式：
站内通知 + 邮件

⸻

9. 智能关键词推荐

9.1 需求背景

用户并不总是知道自己应该监控什么关键词。

很多 AI 热点在爆发前，关键词可能是新产品名、新模型名、新概念，用户未必提前知道。

例如：

Claude Code
Deep Research
Vibe Coding
Manus
MCP
Sora
Operator
Agentic Coding

所以系统不能完全依赖用户手动输入关键词，而是需要主动发现和推荐值得关注的关键词。

⸻

9.2 功能目标

1. 自动发现 AI 圈正在出现的新词。
2. 推荐近期热度上升的关键词。
3. 根据用户关注方向推荐相关关键词。
4. 支持一键添加为监控词。
5. 降低关键词配置门槛。
6. 帮助用户发现潜在趋势。

⸻

9.3 推荐关键词来源

9.3.1 从热点内容中提取

系统从 Twitter / X、RSS、HN、Reddit 抓取内容后，自动提取：

类型	示例
公司	OpenAI、Anthropic、Google DeepMind、Meta AI
产品	ChatGPT、Claude Code、Cursor、Perplexity
模型	GPT-5、Claude、Gemini、Llama、Qwen
技术概念	AI Agent、MCP、RAG、Vibe Coding
开源项目	LangChain、Ollama、ComfyUI、vLLM
竞品工具	Midjourney、Runway、Canva、Evoto
场景词	AI Photo Editor、AI Video、AI Search

⸻

9.3.2 从趋势变化中提取

系统不仅看出现次数，还需要看增长速度。

例如某个词过去 7 天几乎没人提，今天突然大量出现，就应该被推荐。

指标	说明
24 小时出现次数	判断短期热度
7 天增长率	判断是否突然变热
跨平台出现次数	判断是否不是单平台噪音
头部账号提及次数	判断信息权重
互动总量	判断讨论质量
语义聚集度	判断是否形成独立话题

⸻

9.3.3 从用户兴趣中推荐

如果用户已经监控了一些词，可以基于这些词推荐相关词。

例如用户监控：

AI Photo Editor
Evoto
Retouching

系统推荐：

AI Headshot
AI Portrait Retouching
AI Background Remover
Lightroom AI
Photoshop AI
Canva AI

如果用户监控：

Claude Code
Cursor
AI Agent

系统推荐：

Devin
Windsurf
Code Agent
MCP
Agentic Coding
Vibe Coding

⸻

9.4 推荐关键词展示

关键词监控页增加「推荐关注」模块。

推荐分类

推荐关注
- 今日快速上升
- 本周热门关键词
- 和你关注相关
- 竞品相关
- 新出现的 AI 产品
- 高频出现的技术概念

⸻

9.5 推荐词卡片字段

字段	说明
关键词	推荐词名称
推荐理由	为什么推荐
热度	当前热度分
增长率	最近 24h / 7d 增长
来源平台	Twitter / HN / Reddit / RSS
相关热点数量	最近相关内容数量
代表内容	相关热门内容
操作	一键添加监控 / 忽略 / 查看详情

⸻

9.6 推荐卡片示例

关键词：MCP
推荐理由：
过去 24 小时在 Twitter / X 和 HackerNews 中讨论量上升 180%，多个 AI Agent 工具开始支持 MCP。
来源：
Twitter / X：126 条
HackerNews：8 条
Reddit：32 条
操作：
[一键监控] [查看相关热点] [忽略]

⸻

9.7 AI 帮我生成监控词

提供一个自然语言输入框：

告诉我你关注的方向，AI 帮你生成监控关键词。

用户输入：

我想关注 AI 编程工具

系统生成：

Claude Code
Cursor
Windsurf
Devin
AI Coding Agent
MCP
Vibe Coding
Code Review Agent
GitHub Copilot

用户输入：

我想关注 AI 修图和影像工具

系统生成：

AI Photo Editor
AI Retouching
AI Background Remover
AI Portrait
Evoto
Canva AI
Photoshop AI
Lightroom AI
Midjourney
Runway

⸻

9.8 默认关键词模板

系统提供几组开箱即用的监控模板。

AI 编程模板

Claude Code
Cursor
Windsurf
Devin
AI Coding Agent
Vibe Coding
MCP
Code Review Agent
GitHub Copilot

AI 模型模板

OpenAI
ChatGPT
GPT-5
Claude
Gemini
Llama
Qwen
DeepSeek
Grok
Mistral

AI Agent 模板

AI Agent
Agentic AI
Operator
Computer Use
MCP
Browser Agent
Workflow Agent
Deep Research
Autonomous Agent

AI 图像 / 视频模板

AI Image Generator
AI Photo Editor
AI Retouching
AI Video Generator
Sora
Runway
Midjourney
Stable Diffusion
ComfyUI
Canva AI
Photoshop AI

竞品监控模板

Evoto
Lightroom
Photoshop AI
Canva AI
CapCut
Picsart
Runway
Remini
Fotor
Lensa

⸻

9.9 从热点反向订阅关键词

用户在浏览热点时，可以直接将热点中的关键词加入监控。

例如某条热点：

OpenAI releases new Agent SDK with MCP support

系统自动识别：

OpenAI
Agent SDK
MCP
AI Agent

页面展示：

[监控 OpenAI]
[监控 Agent SDK]
[监控 MCP]
[监控 AI Agent]

⸻

9.10 推荐关键词生成流程

flowchart TD
    A[抓取多平台内容] --> B[提取实体和关键词]
    B --> C[统计出现频次]
    C --> D[计算增长趋势]
    D --> E[结合互动数据和来源权重]
    E --> F[过滤低质量词和噪音词]
    F --> G[生成推荐关键词池]
    G --> H[按用户兴趣个性化排序]
    H --> I[展示推荐关键词]
    I --> J[用户一键添加监控]

⸻

10. 热点列表

10.1 页面目标

让用户快速浏览当前最值得关注的 AI 热点。

⸻

10.2 页面模块

顶部筛选区

筛选项	选项
时间范围	1小时 / 6小时 / 24小时 / 7天 / 30天
来源平台	全部 / Twitter / RSS / HN / Reddit
内容类型	模型发布 / 工具产品 / 技术文章 / 开源项目 / 行业观点 / 融资动态
排序方式	综合热度 / 最新发布 / 互动最高 / 增速最快
语言	全部 / 英文 / 中文 / 日文
标签	Agent / 多模态 / 编程工具 / 图像生成 / 视频生成

⸻

10.3 热点卡片字段

字段	说明
标题	热点标题
AI 摘要	一句话说明内容
来源平台	Twitter / RSS / HN / Reddit
作者	原内容作者
发布时间	原始发布时间
热度分	综合热度
互动数据	点赞、转发、评论、投票等
命中关键词	当前内容命中的关键词
标签	模型、Agent、工具、开源等
操作	查看详情、收藏、监控关键词、查看原文

⸻

10.4 热点卡片示例

标题：OpenAI releases new coding model for developers
摘要：
OpenAI 发布了新的代码生成模型，开发者讨论集中在性能、价格和与 Claude Code 的对比上。
来源：
Twitter / X、HackerNews
热度：
92
标签：
OpenAI、Coding Agent、Developer Tool
操作：
[查看详情] [收藏] [监控 OpenAI] [查看原文]

⸻

11. 热点详情

11.1 页面目标

帮助用户快速了解一个热点事件的完整背景、传播情况和相关讨论。

⸻

11.2 页面内容

1. 热点标题。
2. AI 摘要。
3. 原始内容。
4. 来源列表。
5. 相关讨论。
6. 相关关键词。
7. 热度变化趋势。
8. 跨平台传播情况。
9. 相似内容聚合。
10. 原文跳转。
11. 一键收藏。
12. 一键监控相关关键词。
13. 一键生成分享文案。

⸻

11.3 相似内容聚合

同一热点可能在多个平台出现，需要合并展示。

例如：

热点：Claude Code 新版本发布
来源：
- Twitter / X：官方账号发布
- HackerNews：开发者讨论
- Reddit：用户体验反馈
- RSS：官方 Blog 更新

⸻

12. AI 摘要与标签分类

12.1 功能说明

系统对抓取到的内容进行 AI 处理，降低用户阅读成本。

⸻

12.2 AI 处理能力

能力	说明
一句话摘要	快速说明内容是什么
重点提炼	提炼产品、时间、观点、影响
标签分类	自动打上公司、模型、技术方向等标签
情绪判断	判断社区反馈偏正面、负面还是中性
相似内容合并	将同一事件的多平台内容合并
价值判断	判断内容是否值得推荐
分享文案生成	生成适合社媒或周报的摘要

⸻

12.3 标签类型

类型	示例
公司	OpenAI、Anthropic、Google、Meta
模型	GPT、Claude、Gemini、Llama
产品	ChatGPT、Cursor、Sora、Runway
技术方向	Agent、RAG、多模态、本地模型
内容类型	模型发布、产品更新、开源项目、融资、争议、教程
热点级别	普通、热门、爆发

⸻

13. 热点趋势分析

13.1 功能说明

对一定时间范围内的信息进行聚合分析，帮助用户判断趋势。

⸻

13.2 分析维度

1. 过去 24 小时最热 AI 话题。
2. 过去 7 天增长最快关键词。
3. 各平台讨论热度分布。
4. 不同公司 / 产品声量变化。
5. 某个关键词的历史趋势。
6. 热点事件传播路径。
7. 关键词生命周期变化。
8. 竞品声量趋势。

⸻

13.3 示例

过去 24 小时 AI 热点 Top 5：
1. Claude Code 新版本发布
2. OpenAI 新模型 API 价格讨论
3. Cursor 新功能引发开发者热议
4. Local LLM 部署工具爆火
5. AI Agent 在企业自动化场景中的讨论升温

⸻

14. 推送通知

14.1 功能说明

当热点或关键词满足触发条件时，系统自动推送提醒。

⸻

14.2 推送渠道

渠道	优先级
站内通知	P0
邮件	P1
飞书	P1
钉钉	P1
Telegram Bot	P2
Webhook	P2

⸻

14.3 推送触发条件

条件	说明
新内容命中关键词	有新的相关内容出现
热度分超过阈值	单条内容热度较高
讨论量突然上升	短时间内大量出现
被高权重账号提及	官方账号 / KOL 发布
多平台同时出现	跨平台传播
关键词增长异常	关键词出现明显增长

⸻

14.4 推送内容

【AI 热点提醒】
关键词：Claude Code
平台：Twitter / X、HackerNews
热度：89
摘要：
Claude Code 新版本发布后，开发者主要讨论其代码理解能力、上下文长度和与 Cursor 的差异。
相关来源：
- Twitter / X：官方账号发布
- HackerNews：开发者讨论
操作：
[查看详情] [查看原文] [监控相关词]

⸻

15. 页面结构

15.1 首页

页面模块

1. 今日 AI 热点 Top 10。
2. Twitter / X 实时热点。
3. 我关注的关键词动态。
4. 推荐关注关键词。
5. 重点账号最新动态。
6. RSS 官方发布。
7. HackerNews 技术讨论。
8. Reddit 社区观点。
9. AI 自动摘要日报入口。

⸻

15.2 热点列表页

功能

1. 热点筛选。
2. 热点排序。
3. 热点卡片展示。
4. 收藏 / 标记已读。
5. 一键监控关键词。
6. 进入详情页。
7. 跳转原文。

⸻

15.3 热点详情页

功能

1. 原文内容展示。
2. AI 摘要。
3. 热点分析。
4. 相关内容聚合。
5. 来源平台列表。
6. 互动数据。
7. 趋势图。
8. 一键收藏。
9. 一键生成分享文案。
10. 一键监控相关关键词。

⸻

15.4 关键词监控页

功能

1. 新增关键词。
2. 编辑关键词规则。
3. 停用 / 删除关键词。
4. 查看关键词命中记录。
5. 查看关键词趋势。
6. 配置推送方式。
7. 查看推荐关键词。
8. 使用关键词模板。
9. AI 生成监控词。
10. 从热点反向订阅关键词。

⸻

15.5 趋势分析页

功能

1. 热门关键词趋势。
2. 平台热度趋势。
3. 公司 / 产品声量分析。
4. 时间范围筛选。
5. 数据图表展示。
6. 竞品趋势对比。
7. 增长最快关键词榜单。

⸻

15.6 内容库 / 搜索页

功能

1. 全局搜索。
2. 条件筛选。
3. 历史数据查看。
4. 导出数据。
5. 收藏内容管理。
6. 按平台搜索。
7. 按标签搜索。
8. 按时间范围搜索。

⸻

15.7 后台管理页

功能

1. 数据源管理。
2. 关键词管理。
3. 内容管理。
4. 推送管理。
5. 抓取日志。
6. 失败任务重试。
7. 热度算法配置。
8. 用户管理。

⸻

16. 核心流程

16.1 热点信息抓取流程

flowchart TD
    A[定时任务触发] --> B[请求 Twitter / RSS / HN / Reddit 数据]
    B --> C[数据清洗]
    C --> D[内容去重]
    D --> E[关键词匹配]
    E --> F[AI 摘要与标签分类]
    F --> G[热度分计算]
    G --> H[写入热点数据库]
    H --> I[前端展示]

⸻

16.2 关键词监控流程

flowchart TD
    A[用户创建关键词] --> B[配置监控平台和频率]
    B --> C[系统定时检索]
    C --> D[匹配相关内容]
    D --> E[判断是否达到触发条件]
    E -->|达到| F[生成通知]
    E -->|未达到| G[仅记录数据]
    F --> H[站内 / 邮件 / 飞书 / 钉钉推送]

⸻

16.3 热点合并流程

flowchart TD
    A[抓取多平台内容] --> B[提取标题 / 链接 / 关键词 / 语义向量]
    B --> C[判断是否为相似事件]
    C -->|是| D[合并为同一热点]
    C -->|否| E[创建新热点]
    D --> F[更新热度和来源]
    E --> F

⸻

16.4 智能关键词推荐流程

flowchart TD
    A[抓取多平台内容] --> B[提取实体和关键词]
    B --> C[统计出现频次]
    C --> D[计算增长趋势]
    D --> E[结合互动数据和来源权重]
    E --> F[过滤低质量词和噪音词]
    F --> G[生成推荐关键词池]
    G --> H[按用户兴趣排序]
    H --> I[展示推荐关键词]
    I --> J[用户一键添加监控]

⸻

17. 热度算法

17.1 热度分组成

指标	说明	权重示例
发布时间	越新的内容权重越高	15%
X 互动数据	点赞、转发、评论、浏览等	30%
作者权重	官方账号、头部 KOL 权重更高	20%
关键词匹配	命中核心 AI 关键词加权	15%
跨平台传播	多平台同时出现说明更重要	10%
增长速度	短时间内讨论量快速上升	10%

⸻

17.2 公式示例

热度分 = 时间分 * 0.15
      + X互动分 * 0.3
      + 作者权重 * 0.2
      + 关键词匹配分 * 0.15
      + 跨平台传播分 * 0.1
      + 增长速度分 * 0.1

⸻

17.3 热点等级

热点等级	分数范围	说明
爆发	90 - 100	多平台高频出现，短时间快速传播
热门	70 - 89	单平台或多平台有较高讨论
普通	40 - 69	有一定价值，但传播一般
低热度	0 - 39	暂不推荐展示在首页

⸻

18. 数据模型设计

18.1 HotNews 热点表

interface HotNews {
  id: string;
  title: string;
  summary: string;
  content: string;
  sourcePlatform: 'twitter' | 'rss' | 'hackernews' | 'reddit';
  sourceUrl: string;
  author?: string;
  publishedAt: string;
  crawledAt: string;
  heatScore: number;
  tags: string[];
  keywords: string[];
  interactionCount?: {
    likes?: number;
    reposts?: number;
    comments?: number;
    upvotes?: number;
    views?: number;
  };
  status: 'visible' | 'hidden' | 'pending';
}

⸻

18.2 KeywordMonitor 关键词监控表

interface KeywordMonitor {
  id: string;
  userId: string;
  keyword: string;
  synonyms: string[];
  excludeWords: string[];
  platforms: string[];
  frequency: '15m' | '30m' | '1h' | '1d';
  triggerRules: {
    minCount?: number;
    minHeatScore?: number;
    growthRate?: number;
    highWeightAuthor?: boolean;
    crossPlatform?: boolean;
  };
  notifyChannels: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

⸻

18.3 RecommendedKeyword 推荐关键词表

interface RecommendedKeyword {
  id: string;
  keyword: string;
  category:
    | 'company'
    | 'product'
    | 'model'
    | 'technology'
    | 'tool'
    | 'competitor'
    | 'topic';
  reason: string;
  heatScore: number;
  growthRate: number;
  sourcePlatforms: Array<'twitter' | 'rss' | 'hackernews' | 'reddit'>;
  mentionCount24h: number;
  mentionCount7d: number;
  relatedNewsIds: string[];
  status: 'recommended' | 'ignored' | 'added';
  createdAt: string;
}

⸻

18.4 SourceConfig 数据源配置表

interface SourceConfig {
  id: string;
  platform: 'twitter' | 'rss' | 'hackernews' | 'reddit';
  name: string;
  url?: string;
  keyword?: string;
  accountHandle?: string;
  enabled: boolean;
  crawlInterval: number;
  lastCrawledAt?: string;
  status: 'normal' | 'failed' | 'limited';
}

⸻

19. 后台管理功能

19.1 数据源管理

1. 添加 / 删除 RSS 源。
2. 配置 Twitter / X 监控账号。
3. 配置 Twitter / X 关键词。
4. 配置 Reddit subreddit。
5. 配置 HackerNews 关键词。
6. 配置平台抓取频率。
7. 查看数据源状态。
8. 查看最近抓取成功 / 失败记录。

⸻

19.2 关键词管理

1. 维护系统默认 AI 关键词。
2. 配置关键词权重。
3. 配置同义词。
4. 配置屏蔽词。
5. 配置关键词分类。
6. 管理推荐关键词池。
7. 管理关键词模板。

⸻

19.3 内容管理

1. 查看抓取内容列表。
2. 手动隐藏低质量内容。
3. 手动合并相似热点。
4. 编辑 AI 摘要。
5. 编辑标签。
6. 标记内容质量。
7. 查看原始内容。
8. 查看热点计算明细。

⸻

19.4 推送管理

1. 配置推送渠道。
2. 配置推送模板。
3. 查看推送记录。
4. 查看推送失败原因。
5. 重试失败推送。
6. 配置推送频率限制。

⸻

20. 权限与账号体系

20.1 未登录用户

1. 查看公开热点列表。
2. 查看部分热点详情。
3. 使用基础搜索。
4. 查看推荐关键词。

⸻

20.2 登录用户

1. 创建关键词监控。
2. 收藏热点。
3. 配置推送方式。
4. 查看个人监控记录。
5. 使用 AI 生成监控词。
6. 使用关键词模板。
7. 生成个人 AI 日报。
8. 标记已读 / 忽略内容。

⸻

20.3 管理员

1. 管理数据源。
2. 管理关键词库。
3. 管理内容质量。
4. 管理用户权限。
5. 查看系统运行状态。
6. 调整热度算法权重。
7. 管理推送配置。

⸻

21. 非功能需求

21.1 性能要求

1. 首页首屏加载时间控制在 2 秒以内。
2. 热点列表支持分页或虚拟滚动。
3. 抓取任务异步执行，不影响前端访问。
4. 关键词监控任务支持队列化处理。
5. 热点数据支持缓存，降低数据库压力。
6. 热点详情页接口响应控制在 1 秒以内。

⸻

21.2 稳定性要求

1. 单个平台抓取失败不影响其他平台。
2. 抓取任务失败后支持重试。
3. API 限流时自动降级。
4. 推送失败后记录失败原因并支持重试。
5. 定时任务需要有日志和告警。
6. 队列积压时需要有监控报警。

⸻

21.3 安全要求

1. API Key 加密存储。
2. 用户数据隔离。
3. 防止恶意关键词刷请求。
4. 管理后台需要权限校验。
5. 对外接口需要限流。
6. 推送 Webhook 需要签名验证。
7. 敏感配置不可暴露到前端。

⸻

21.4 可扩展性要求

1. 数据源接入采用插件化设计。
2. 新增平台时不影响现有抓取逻辑。
3. 热度算法支持配置化调整。
4. AI 摘要模型支持替换。
5. 推送渠道支持扩展。
6. 推荐关键词算法支持独立迭代。

⸻

22. 技术方案建议

22.1 前端

建议技术栈：

Next.js / Nuxt
TypeScript
Tailwind CSS
React Query / TanStack Query
ECharts / Recharts
Zustand / Pinia

核心页面：

1. 首页。
2. 热点列表页。
3. 热点详情页。
4. 关键词监控页。
5. 趋势分析页。
6. 内容库搜索页。
7. 后台管理页。

⸻

22.2 后端

建议技术栈：

Node.js / NestJS
PostgreSQL
Redis
BullMQ
Prisma
OpenAI / Claude / Gemini API
定时任务调度器

核心服务：

1. 数据抓取服务。
2. 内容清洗服务。
3. AI 摘要服务。
4. 标签分类服务。
5. 热度计算服务。
6. 关键词监控服务。
7. 智能关键词推荐服务。
8. 推送通知服务。
9. 用户服务。

⸻

22.3 系统架构

flowchart LR
    A[Twitter / X] --> B[数据抓取服务]
    A2[RSS] --> B
    A3[HackerNews] --> B
    A4[Reddit] --> B
    B --> C[消息队列]
    C --> D[内容清洗与去重]
    D --> E[AI 摘要与标签分类]
    E --> F[热度计算]
    F --> G[(PostgreSQL)]
    G --> H[API 服务]
    H --> I[前端网站]
    G --> J[关键词监控服务]
    G --> K[智能关键词推荐服务]
    J --> L[通知服务]
    L --> M[站内 / 邮件 / 飞书 / 钉钉 / Telegram]

⸻

23. MVP 版本规划

23.1 V0.1：Twitter / X + RSS 基础聚合版

目标

先覆盖用户最高频的信息来源，并用 RSS 补充官方和媒体信息。

P0 功能

1. Twitter / X 关键词监控。
2. Twitter / X 指定账号监控。
3. RSS 数据源接入。
4. 热点列表页。
5. 热点详情页。
6. AI 摘要。
7. 基础标签分类。
8. 基础热度排序。
9. 内容去重。
10. 原文跳转。
11. 推荐关键词基础版。

暂不做

1. 复杂趋势图表。
2. 多用户复杂权限。
3. Reddit 深度评论分析。
4. 自动日报 / 周报。
5. 多渠道推送。
6. 复杂后台管理。

⸻

23.2 V0.2：多平台热点增强版

目标

接入更多技术社区，提升热点判断准确度。

功能

1. HackerNews 接入。
2. Reddit 接入。
3. 多平台相似热点合并。
4. 热点来源分布。
5. 跨平台热度加权。
6. 关键词趋势统计。
7. 推荐关键词增强版。

⸻

23.3 V0.3：关键词监控与推送版

目标

从“看热点”升级为“自动提醒”。

功能

1. 用户自定义关键词。
2. 关键词监控规则配置。
3. 站内通知。
4. 邮件通知。
5. 飞书 / 钉钉 / Telegram 推送。
6. 关键词命中记录。
7. 关键词趋势页。
8. 推送频率控制。

⸻

23.4 V0.4：趋势分析与日报版

目标

从“信息聚合”升级为“趋势洞察”。

功能

1. 热门关键词趋势。
2. 热点传播路径。
3. 平台声量对比。
4. 公司 / 产品声量分析。
5. 自动生成 AI 日报。
6. 自动生成 AI 周报。
7. 竞品监控报表。

⸻

24. 核心指标

24.1 产品指标

指标	说明
DAU	每日活跃用户
热点点击率	用户点击热点详情的比例
收藏率	用户收藏热点内容的比例
关键词创建数	用户创建监控关键词数量
推荐关键词添加率	推荐词被添加为监控词的比例
推送打开率	用户收到通知后的打开比例
搜索次数	用户主动检索内容的次数
日报生成次数	用户使用日报能力的次数

⸻

24.2 内容质量指标

指标	说明
有效热点率	抓取内容中被用户点击或收藏的比例
重复率	相同事件重复展示的比例
摘要准确率	AI 摘要是否准确
标签准确率	AI 分类是否正确
推送命中率	推送内容是否符合用户关注点
推荐关键词有效率	推荐词是否被用户采纳

⸻

24.3 系统指标

指标	说明
抓取成功率	各平台数据抓取是否稳定
抓取延迟	原平台发布到网站展示的时间差
API 错误率	服务接口失败比例
推送成功率	通知发送成功比例
队列积压数	抓取和 AI 处理任务是否堆积
AI 处理耗时	摘要、分类、推荐计算耗时

⸻

25. 风险与应对

风险	说明	应对方案
Twitter / X API 成本高	官方 API 价格可能较高	控制关键词数量和轮询频率，优先监控高价值账号
平台限流	高频抓取可能触发限制	使用队列、缓存、限频、失败重试
内容重复	多平台会讨论同一热点	URL 去重 + 标题相似度 + 语义向量合并
AI 摘要不准确	摘要可能误解原文	保留原文链接，支持人工编辑
热度算法不准	早期排序可能不符合预期	支持权重配置，结合用户行为优化
推荐关键词噪音高	推荐词可能不够准确	加入黑名单、低质量词过滤和用户反馈
推送打扰用户	过多通知影响体验	支持阈值、频率和免打扰配置
数据合规风险	抓取平台内容需遵守规则	优先使用官方 API / RSS / 合规数据源

⸻

26. 优先级汇总

P0 必做

1. Twitter / X 关键词监控。
2. Twitter / X 指定账号监控。
3. RSS 数据源接入。
4. 热点列表页。
5. 热点详情页。
6. AI 摘要。
7. 基础标签分类。
8. 热度排序。
9. 内容去重。
10. 原文跳转。
11. 推荐关键词基础能力。
12. 基础后台数据源配置。

⸻

P1 重要

1. HackerNews 接入。
2. Reddit 接入。
3. 自定义关键词规则。
4. 站内通知。
5. 邮件推送。
6. 收藏功能。
7. 搜索功能。
8. 热点趋势图。
9. AI 生成监控词。
10. 关键词模板。

⸻

P2 后续增强

1. 自动日报 / 周报。
2. 飞书 / 钉钉 / Telegram 推送。
3. GitHub / Product Hunt / arXiv 接入。
4. 竞品声量分析。
5. 传播路径分析。
6. 浏览器插件。
7. 自动生成内容选题。
8. 个性化推荐。

⸻

27. 产品差异化能力

27.1 不只是聚合，而是自动发现

传统信息聚合依赖用户主动输入关键词。
AI Hot News 需要做到：

用户不知道该关注什么，系统也能根据全网热点主动推荐值得关注的关键词。

⸻

27.2 以 Twitter / X 为核心

Twitter / X 是 AI 热点最早爆发的平台之一，因此产品第一版就需要接入。

核心策略：

Twitter / X 负责发现早期热点
RSS 负责补充官方信源
HackerNews 负责补充技术讨论
Reddit 负责补充社区反馈

⸻

27.3 从信息流升级为行业情报

后续可以支持：

1. AI 热点日报。
2. AI 热点周报。
3. 竞品监控。
4. 趋势预警。
5. 内容选题生成。
6. 投资 / 产品方向分析。

⸻

28. 总结

AI Hot News 的核心价值是：

用自动化抓取、关键词监控、智能关键词推荐和 AI 摘要能力，替代人工刷信息，帮助用户更快发现 AI 行业热点、追踪关键词动态，并沉淀长期趋势数据。

最合理的 MVP 是：

Twitter / X + RSS 先跑通热点聚合和关键词监控，
再接入 HackerNews 和 Reddit 做技术社区补充，
最后扩展趋势分析、推送、日报和竞品监控。

第一阶段重点解决三个问题：

1. 不用反复手动刷 Twitter / X。
2. 能持续监控自己关注的 AI 关键词。
3. 不知道该关注什么时，系统能推荐值得监控的新词。