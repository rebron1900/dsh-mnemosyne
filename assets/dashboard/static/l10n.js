
    // ── DSH locale bridge: localize the upstream dashboard chrome so it
    // follows the host GUI language (Chinese when DSH runs in zh). The
    // language comes from the iframe query (?lang=), the parent document
    // lang, or the browser preference, in that order.
    (function () {
      var ZH = {
        "Mnemosyne": "Mnemosyne 记忆",
        "Hermes Memory": "Hermes 记忆",
        "Overview": "总览",
        "Today": "今日",
        "Visualiser": "可视化",
        "Memories": "记忆",
        "Context Bank": "上下文库",
        "Lifecycle": "生命周期",
        "Knowledge Graph": "知识图谱",
        "MEMORIA": "MEMORIA",
        "History": "活动",
        "Settings": "设置",
        "Search memory…": "搜索记忆…",
        "Search memory": "搜索记忆",
        "Search": "搜索",
        "Refresh": "刷新",
        "Open graph": "打开图谱",
        "Search everything": "全局搜索",
        "Browse memories": "浏览记忆",
        "Latest activity": "最近活动",
        "Today in memory": "今日记忆",
        "read-only daily digest": "只读每日摘要",
        "Live memory stream": "实时记忆流",
        "latest memories": "最新记忆",
        "Working": "工作记忆",
        "Episodic": "情景记忆",
        "Needs review": "待审阅",
        "Degraded": "已降级",
        "Triples": "三元组",
        "Consolidations": "整合记录",
        "Added": "新增",
        "Retrieved": "召回",
        "Lifecycle changes": "生命周期变化",
        "Facts": "事实",
        "Active memories": "活跃记忆",
        "Due for degradation": "待降级",
        "Scroll to load older memories.": "滚动加载更早的记忆。",
        "End of memory stream.": "记忆流已到末尾。",
        "Loading older memories…": "正在加载更早的记忆…",
        "No memories found.": "没有找到记忆。",
        "No data": "暂无数据",
        "no session": "无会话",
        "No triples match this graph filter. Add facts with mnemosyne_triple_add or mnemosyne_remember(... extract=true).": "没有符合图谱筛选的三元组。",
        "No items in this queue.": "该队列为空。",
        "This queue is clear for now.": "当前没有待处理项。",
        "No review queues available.": "没有可用的审阅队列。",
        "No memories added today.": "今日没有新增记忆。",
        "No memories recalled today.": "今日没有召回记忆。",
        "No facts added today.": "今日没有新增三元组。",
        "No consolidations today.": "今日没有整合记录。",
        "working": "工作记忆",
        "episodic": "情景记忆",
        "user": "用户",
        "assistant": "助手",
        "system": "系统",
        "active": "活跃",
        "superseded": "已取代",
        "expired": "已过期",
        "stated": "已声明",
        "inferred": "推断",
        "unknown": "未知",
        "Detail": "详情",
        "Memory detail": "记忆详情",
        "Copy ID": "复制 ID",
        "Close": "关闭",
        "Please provide valid API configuration": "请提供有效的 API 配置",
         "Mnemosyne Dashboard": "Mnemosyne 记忆面板",
         "Hermes memory console": "Hermes 记忆控制台",
         "Private memory, cleanly mapped.": "私有记忆，清晰呈现。",
         "Search, review, and trace working memories, summaries, triples, and consolidation history from one local dashboard.": "在本地面板中搜索、审阅和追踪工作记忆、摘要、三元组与整合历史。",
         "Database": "数据库",
         "loading…": "加载中…",
         "Trust mix": "可信度分布",
         "Sources": "来源",
         "Scopes": "作用域",
         "Top sessions": "热门会话",
         "25 latest memories": "25 条最新记忆",
         "Today in memory": "今日记忆",
         "Top entities": "热门实体",
         "Sessions": "会话",
         "read-only daily digest": "只读每日摘要",
         "Relationship graph": "关系图谱",
         "Facts table": "事实表",
         "Graph inspector": "图谱检查器",
         "Nothing selected": "未选择内容",
         "Pick a node or edge to inspect connected triples, then jump into the Triples table.": "选择节点或边以查看关联三元组，然后跳转到三元组表。",
         "click nodes / edges to inspect": "点击节点或边查看详情",
         "Filter graph by subject / predicate / object…": "按主语 / 谓语 / 宾语筛选图谱…",
         "Search subject / predicate / object…": "搜索主语 / 谓语 / 宾语…",
         "Subject": "主语",
         "Predicate": "谓语",
         "Object": "宾语",
         "Confidence": "置信度",
         "Reset view": "重置视图",
         "Memory browser": "记忆浏览器",
         "Recall debug": "召回调试",
         "working + episodic": "工作记忆 + 情景记忆",
         "Search memory content…": "搜索记忆内容…",
         "all tiers": "全部层级",
         "all sources": "全部来源",
         "all scopes": "全部作用域",
         "all sessions": "全部会话",
         "all trust levels": "全部可信度",
         "all lifecycle tiers": "全部生命周期层级",
         "all confidence": "全部置信度",
         "degraded only": "仅已降级",
         "due for degradation": "待降级",
         "all statuses": "全部状态",
         "newest": "最新",
         "oldest": "最早",
         "recall count": "召回次数",
         "Select visible": "选择当前列表",
         "0 selected": "已选择 0 项",
         "Expire selected": "使所选记忆过期",
         "Set trust": "设置可信度",
         "Set expiry": "设置有效期",
         "Set importance": "设置重要性",
         "Clear selection": "清除选择",
         "Type a recall query…": "输入召回查询…",
         "why memories rank": "记忆排序原因",
         "Filter timeline…": "筛选时间线…",
         "group by day": "按日期分组",
         "group by session": "按会话分组",
         "day / session stream": "日期 / 会话流",
         "Filter summaries / sessions…": "筛选摘要 / 会话…",
         "Each run shows compressed-memory previews and session actions.": "每次运行显示压缩记忆预览和会话操作。",
         "click entries to inspect": "点击条目查看详情",
         "Facts": "事实",
         "Timelines": "时间线",
         "Instructions": "指令",
         "Preferences": "偏好",
         "Table counts": "表计数",
         "structured fact extraction and retrieval": "结构化事实提取与检索",
         "extracted fact triples from conversations": "从对话中提取的事实三元组",
         "temporal event sequences": "时间事件序列",
         "extracted instructions and guidelines": "提取的指令与指南",
         "knowledge graph triples": "知识图谱三元组",
         "extracted user preferences": "提取的用户偏好",
         "Search facts…": "搜索事实…",
         "Search timelines…": "搜索时间线…",
         "Search instructions…": "搜索指令…",
         "Search KG…": "搜索知识图谱…",
         "Search preferences…": "搜索偏好…",
         "access control": "访问控制",
         "Password auth": "密码认证",
         "Enable password": "启用密码",
         "Set / change password": "设置 / 更改密码",
         "Save auth settings": "保存认证设置",
         "Disable + clear password": "停用并清除密码",
         "Logout": "退出登录",
         "Server + database": "服务器与数据库",
         "Address / host": "地址 / 主机",
         "Port": "端口",
         "Database location": "数据库位置",
         "Save server settings": "保存服务器设置",
         "Memory maintenance": "记忆维护",
         "Enable admin maintenance mode": "启用管理维护模式",
         "Backup database before every mutation": "每次修改前备份数据库",
         "Save admin mode": "保存管理模式",
         "Create backup now": "立即创建备份",
         "View audit log": "查看审计日志",
         "Database diagnostics": "数据库诊断",
         "Refresh diagnostics": "刷新诊断",
         "Copy diagnostics": "复制诊断信息",
         "Runtime diagnostics": "运行时诊断",
         "Frontend boot error": "前端启动错误",
         "Retry load": "重试加载",
         "Copy error details": "复制错误详情",
         "Password required": "需要密码",
         "This dashboard has optional password auth enabled.": "此面板已启用可选密码认证。",
         "Unlock": "解锁",
         "No entries found.": "没有找到条目。",
         "No triples found.": "没有找到三元组。",
         "No consolidations found.": "没有找到整合记录。",
         "No inferred profile data found.": "没有找到推断的上下文数据。",
         "No patterns yet.": "暂时没有模式数据。",
         "No timeline events.": "没有时间线事件。",
         "No results found.": "没有找到结果。",
          "Recalled": "已召回",
          "Lifecycle changes": "生命周期变化",
          "Memories scanned": "扫描记忆数",
          "Triples scanned": "扫描三元组数",
          "Patterns found": "发现模式数",
          "Provider": "提供方",
          "Confidence unknown": "置信度未知",
          "Review queue": "审阅队列",
          "Search this queue…": "搜索此队列…",
          "Min importance": "最低重要性",
          "Apply filters": "应用筛选",
          "Clear": "清除",
          "Select listed": "选择当前列表",
          "Open filtered browser": "打开筛选后的浏览器",
          "No items in this queue.": "该队列为空。",
          "This queue is clear for now.": "当前没有待处理项。",
          "No review queues available.": "没有可用的审阅队列。",
          "High importance": "高重要性",
          "Due for degradation": "待降级",
          "Status": "状态",
          "DB path": "数据库路径",
          "Readable": "可读",
          "Size": "大小",
          "Last modified": "最后修改",
          "Tables": "数据表",
          "Core rows": "核心行数",
          "OK": "正常",
          "Needs attention": "需要关注",
          "yes": "是",
          "no": "否",
          "none": "无",
          "Database looks healthy.": "数据库状态正常。",
          "Search failed.": "搜索失败。",
          "No memory records matched.": "没有匹配的记忆记录。",
          "Search from the sidebar or type a query above.": "请从侧边栏搜索，或在上方输入查询。",
          "Search looks across memories, facts, and consolidations.": "搜索范围包括记忆、事实和整合记录。",
          "No matching memories.": "没有匹配的记忆。",
          "No facts added today.": "今日没有新增事实。",
          "No memories added today.": "今日没有新增记忆。",
          "No memories recalled today.": "今日没有召回记忆。",
          "No consolidations today.": "今日没有整合记录。",
          "No connected edges.": "没有关联边。",
          "Selected node": "已选节点",
          "Selected triple": "已选三元组",
          "Show in Triples": "在三元组中显示",
          "Search memories": "搜索记忆",
          "Inspect JSON": "查看 JSON",
          "Entity/topic": "实体 / 主题",
          "Memory": "记忆",
          "Visualiser mode": "可视化模式",
          "Constellation": "星座图",
          "Neural Map": "神经图",
          "Pause rotation": "暂停旋转",
          "Fullscreen": "全屏",
          "Exit fullscreen": "退出全屏",
          "Drag to rotate · Pan mode/Shift-drag to pan · wheel/pinch to zoom.": "拖动旋转 · 平移模式 / Shift+拖动平移 · 滚轮或双指缩放。",
          "Interactive 3D memory visualiser": "交互式 3D 记忆可视化",
          "Mnemosyne Labyrinth": "Mnemosyne 迷宫",
          "artifact rooms + memory dungeon exploration": "记忆房间与探索模式",
          "Refresh palace": "刷新迷宫",
          "Reset diver": "重置漫游器",
          "Beacon search…": "搜索信标…",
          "WASD to move · drag to look · tap relics · artifact rooms · Memory Diver + Hammy drone": "使用 WASD 移动 · 拖动视角 · 点击记忆遗物 · 探索记忆房间",
          "Memory Diver": "记忆漫游器",
          "The Archive Gate": "档案之门",
          "Hammy drone online": "Hammy 无人机在线",
          "Enter the Archive Gate": "进入档案之门",
          "relationships + triple table": "关系与三元组表",
          "activity stream": "活动流",
          "This Mac": "本机",
          "Current access URLs": "当前访问地址",
          "Password is set.": "已设置密码。",
          "No password set.": "未设置密码。",
          "Database is read-only.": "数据库为只读。"
       };
       var LANG = (function () {
        try {
          var q = new URLSearchParams(location.search).get("lang");
          if (q === "zh" || q === "en") return q;
        } catch (e) {}
        try {
          var p = window.parent && window.parent.document && window.parent.document.documentElement;
          if (p && /^zh/i.test(p.lang || "")) return "zh";
        } catch (e) {}
        return /^zh/i.test(navigator.language || "") ? "zh" : "en";
      })();
      var DICT = LANG === "zh" ? ZH : null;
      document.documentElement.lang = LANG;
      function translateText(value) {
         var text = String(value || "").trim();
         if (!text || !DICT) return value;
         if (DICT[text]) return DICT[text];
         var match = text.match(/^(\d+) (entries|listed|events|selected)$/);
         if (match) {
           var unit = { entries: "条", listed: "项", events: "个事件", selected: "项已选" }[match[2]];
           return match[1] + " " + unit;
         }
         return value;
       }
       function setText(node, text) {
        if (node.textContent !== text) node.textContent = text;
      }
      // Map a node's whole text (single text child). Idempotent: the mapped
      // value is never itself a dict key, so re-runs are no-ops.
      function localizeNode(node) {
        if (!DICT) return;
        if (!node || node.nodeType !== 1) return;
        if (node.tagName === "INPUT" && node.placeholder) {
          var ph = DICT[node.placeholder];
          if (ph && node.placeholder !== ph) node.placeholder = ph;
          return;
        }
        if (node.tagName === "TEXTAREA" && node.placeholder) {
          var ph2 = DICT[node.placeholder];
          if (ph2 && node.placeholder !== ph2) node.placeholder = ph2;
          return;
        }
        var text = (node.childNodes.length === 1 && node.firstChild.nodeType === 3) ? node.textContent.trim() : "";
        if (!text) return;
        var mapped = DICT[text];
        if (mapped) setText(node, mapped);
      }
      // Nav buttons have a leading <span> badge plus a trailing text node:
      // translate only the trailing text and keep the badge.
      function localizeNavButton(btn) {
        if (!DICT) return;
        var tail = btn.lastChild;
        if (tail && tail.nodeType === 3) {
          var mapped = DICT[tail.textContent.trim()];
          if (mapped && tail.textContent.trim() !== mapped) tail.textContent = mapped;
        }
        btn.setAttribute("title", btn.textContent.trim());
      }
      function localizeAll() {
        if (!DICT) return;
        document.querySelectorAll("nav button[data-tab]").forEach(localizeNavButton);
        var selectors = [
          ".section-head h2", ".section-head span", ".brand-sub",
          ".menu-search input", ".menu-search button",
          ".card .label", ".toolbar button", ".quick-actions button",
          "#liveMemoryStatus", ".state-card h3", ".state-card p", ".muted",
          ".app-footer", ".kind-badge", ".role", ".drawer-title",
          ".section-tabs button", ".tiny", "button.primary"
        ].join(",");
        document.querySelectorAll(selectors).forEach(function (el) { localizeNode(el); });
         if (DICT && DICT[document.title]) document.title = DICT[document.title];
         var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
         var textNode;
         while (textNode = walker.nextNode()) {
           var parent = textNode.parentElement;
           if (!parent || parent.closest(".content, .db-path, pre, .detail-content, [data-json], script, style")) continue;
           var raw = textNode.textContent.trim();
           var translated = translateText(raw);
           if (raw && translated !== raw) textNode.textContent = textNode.textContent.replace(raw, translated);
         }
      }
      window.__mnemoL10n = { LANG: LANG, localize: localizeAll };
      document.addEventListener("DOMContentLoaded", function () {
        localizeAll();
        if (!DICT) return;
        var t = null;
        var mo = new MutationObserver(function () {
          clearTimeout(t);
          t = setTimeout(localizeAll, 120);
        });
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    })();
