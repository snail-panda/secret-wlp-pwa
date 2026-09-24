(() => {
  'use strict';

  const STUDY_PREF_KEY = 'wlp:stage7:study-options:v1';
  const CARD_MODE_KEY = 'fc:cardMode';
  const VOICE_KEY = 'fc:voiceName';
  const PRACTICE_MODE_KEY = 'wlp:study-hub-practice-mode:v1';
  const STANDARD_SIZE_KEY = 'wlp:studyq:session-size-default:v1';
  const AI_SIZE_KEY = 'wlp:ai-study-session-size:v1';
  const AI_HINT_KEY = 'wlp:ai-study-hint-limit:v1';
  const PROGRESS_OPTIONS_KEY = 'wlp:stage7:progress-options:v1';
  const ROLE_KEY = 'wlp:ui-role:v2';
  const SESSION_ROLE_KEY = 'wlp:session-admin:v1';

  const GENERAL_SETTINGS_KEY = 'wlp:settings:general:v1';
  const LANGUAGE_MODES = ['en','ja','en-ja-guide'];
  const JA_TEXT = {
  "Control center": "コントロールセンター",
  "Settings": "設定",
  "See how WLP is configured, understand what each area controls, and adjust shared preferences from one place.": "WLP全体がどう設定されているかを確認し、各領域の役割を理解しながら、共通設定を一か所で調整できます。",
  "Back to Home": "ホームへ戻る",
  "General": "一般",
  "WLP-wide foundation": "WLP全体の基本設定",
  "Study": "学習",
  "Cards, audio & navigation": "カード・音声・操作",
  "Practice": "練習",
  "Standard & AI defaults": "Standard / AI の既定値",
  "Progress & Review": "進捗・復習",
  "Dashboard & attention": "ダッシュボード・復習注意度",
  "Resources": "リソース",
  "Reference & pronunciation": "参照・発音",
  "Data & Access": "データ・アクセス",
  "Local data & authoring": "ローカルデータ・作成機能",
  "Your WLP at a glance": "WLP設定の全体像",
  "General is the home for app-wide preferences. It also acts as a map of the more specialized settings below.": "一般設定はWLP全体に関わる設定の入口です。下にある専門的な設定領域への地図としても機能します。",
  "Card display, audio, references and navigation": "カード表示・音声・参照・ナビゲーション",
  "Standard and AI defaults": "Standard / AI Practice の既定値",
  "Default dashboard": "標準ダッシュボード",
  "What Progress shows and how Review is understood": "Progressの表示内容とReviewの考え方",
  "Reference tools and pronunciation sources": "参照ツールと発音ソース",
  "Language & Display": "言語・表示",
  "Interface language": "インターフェース言語",
  "Foundation": "基本",
  "Choose how WLP presents interface language. English + Japanese guidance keeps the interface in English while adding concise Japanese explanations where they help you understand the structure.": "WLPのインターフェース言語を選びます。「English + 日本語 guidance」では英語UIを保ちながら、構造を理解しやすい場所に短い日本語説明を添えます。",
  "This preference is saved as WLP-wide. This first rollout applies it to Settings itself; the same saved preference can be extended to shared navigation and other feature screens without changing the setting later.": "この設定はWLP全体の設定として保存されます。今回の第一段階ではSettings自身に適用し、今後は同じ保存値を共通ナビゲーションや各機能画面へ拡張できます。",
  "Appearance": "外観",
  "WLP-wide presentation": "WLP全体の表示",
  "Color theme": "カラーテーマ",
  "Garden": "Garden",
  "Text size": "文字サイズ",
  "Standard": "標準",
  "Interface density": "インターフェース密度",
  "These are the current app-wide presentation defaults. Theme, text-size, and density controls belong here, but they should only become editable after the shared UI has been audited so every WLP page changes consistently.": "現在のWLP全体の表示既定値です。テーマ・文字サイズ・表示密度はここで管理しますが、全ページで一貫して反映できることを確認してから編集可能にします。",
  "Access": "アクセス",
  "Current environment": "現在の環境",
  "Guest": "ゲスト",
  "Admin": "管理者",
  "Data model": "データモデル",
  "Local-first": "ローカル優先",
  "Authoring": "作成機能",
  "Locked in Guest mode": "Guestモードではロック",
  "Available in Admin mode": "Adminモードで利用可能",
  "Study data": "学習データ",
  "This browser": "このブラウザ",
  "Admin mode available": "Adminモード利用可能",
  "Admin access required": "Adminアクセスが必要",
  "Study Options, unfolded": "Study Optionsの全体像",
  "The quick Study Options drawer is optimized for fast changes while studying. Here the same preferences are spread out so the whole system is easier to understand.": "普段のStudy Optionsドロワーは学習中の素早い変更向けです。ここでは同じ設定を広げて整理し、全体像を理解しやすくします。",
  "Open Study Options": "Study Optionsを開く",
  "Open Study": "Studyを開く",
  "Card Content": "カード内容",
  "How much of the back side is visible": "カード裏面の表示範囲",
  "Focus": "Focus",
  "Full": "Full",
  "Custom": "Custom",
  "Definition": "Definition",
  "Semantic boundary": "意味の境界",
  "Always shown": "常に表示",
  "Examples": "Examples",
  "Usage in context": "文脈での用例",
  "Shown": "表示",
  "Collapsed": "折りたたみ",
  "Hidden": "非表示",
  "Synonyms": "Synonyms",
  "Related expressions": "関連表現",
  "Notes": "Notes",
  "Nuance and detail": "ニュアンス・詳細",
  "IPA": "IPA",
  "Show pronunciation notation": "発音表記を表示",
  "Part of Speech": "品詞",
  "Show grammatical label": "文法ラベルを表示",
  "Study Direction": "学習方向",
  "Default Study Side": "既定のStudy Side",
  "Word First": "単語から",
  "This is the same default used by Study Options and also updates the current Study direction.": "Study Optionsと同じ既定値です。現在のStudy方向にも反映されます。",
  "Definition First": "定義から",
  "Card Controls": "カード操作",
  "What appears around the Study card": "Study Card周辺の表示",
  "Display": "表示",
  "Helper labels": "補助ラベル",
  "Captions such as Listen, Voice, and Record your pronunciation": "Listen・Voice・Record your pronunciationなどの補助表示",
  "Shuffle": "シャッフル",
  "Show the Shuffle control above the card": "カード上部にShuffle操作を表示",
  "Recording": "録音",
  "Show pronunciation recording controls": "発音録音コントロールを表示",
  "Audio": "音声",
  "Voice & Read Aloud": "音声・読み上げ",
  "Shared preference": "共通設定",
  "Preferred Study Voice": "優先Study音声",
  "The selected English system voice used by Study": "Studyで使用する英語システム音声",
  "System default": "システム既定",
  "Default Read Aloud target": "既定のRead Aloud対象",
  "What the main Read action starts with": "メインのRead操作で最初に読む対象",
  "Read All": "すべて読む",
  "Reference & Pronunciation": "参照・発音",
  "Tools available from the Study card": "Study Cardの参照ツール",
  "External Reference": "外部参照",
  "Images": "画像",
  "JP Reference": "日本語参照",
  "Show real-speech pronunciation reference": "実際の発話による発音参照を表示",
  "YouGlish accent": "YouGlishアクセント",
  "Default pronunciation reference accent": "発音参照の既定アクセント",
  "Navigation": "ナビゲーション",
  "Moving through cards": "カード移動",
  "Interaction": "操作",
  "Swipe to change cards": "スワイプでカード移動",
  "Horizontal swipes move between Study cards": "横スワイプでStudy Cardを移動",
  "Practice keeps its fast controls in Study Hub. Settings gives you the wider view of the defaults that persist between sessions.": "Practiceの素早い操作はStudy Hubに残し、Settingsではセッション間で保持される既定値を全体的に確認できます。",
  "Open Practice": "Practiceを開く",
  "Practice Mode": "Practiceモード",
  "Default mode": "既定モード",
  "Practice mode": "Practiceモード",
  "Which mode Study Hub opens with": "Study Hubを開いたときのモード",
  "Standard Practice": "Standard Practice",
  "AI Practice": "AI Practice",
  "Non-AI practice with your own self-rating after each experience.": "AIを使わず、各experience後に自分で評価するPracticeです。",
  "Default experiences": "既定experience数",
  "Saved Standard Practice session-size preference": "保存されるStandard Practiceのセッション数",
  "Not saved": "未保存",
  "AI-generated practice with saved session-size and hint defaults.": "AI生成Practice。セッション数とHint数の既定値を保存します。",
  "Saved AI Practice session-size preference": "保存されるAI Practiceのセッション数",
  "Hint limit": "Hint上限",
  "Maximum hints available per AI experience": "AI experienceごとに使える最大Hint数",
  "No hints": "Hintなし",
  "Difficulty and experience-type choices remain session controls because the current AI implementation does not persist them as defaults.": "Difficultyとexperience typeは現在のAI実装では既定値として保存されないため、セッション側の操作として残します。",
  "What the learning dashboard is showing you": "学習ダッシュボードの構成",
  "Progress has four different views. These controls make that structure explicit and choose which panels appear in each one. They never delete progress data.": "Progressには4つのビューがあります。ここではその構造を明確にし、各ビューに表示するパネルを選びます。Progressデータ自体は削除しません。",
  "Open Progress": "Progressを開く",
  "Open Review": "Reviewを開く",
  "Overview": "概要",
  "Where you are, what needs attention, and what to do next.": "現在地・注意が必要なもの・次にすること。",
  "Landscape": "全体像",
  "Coverage across the vocabulary garden.": "語彙全体にわたるカバレッジ。",
  "Paths": "学習経路",
  "How Card, Standard, and AI create different learning routes.": "Card・Standard・AIが作る異なる学習経路。",
  "Activity": "活動",
  "What you actually did over time.": "実際に何をしたかを時間軸で確認。",
  "Restore default Progress panels": "Progressパネルを既定に戻す",
  "Review": "復習",
  "Attention, not a mastery score": "習熟度ではなく注意度",
  "Review means you want continued attention on an entry. Light, Medium, and High describe attention level; a successful practice attempt does not automatically remove Review.": "Reviewは、その項目に継続して注意を向けたいという意味です。Light / Medium / Highは、その項目に向けるべき注意度の度合いを表します。Practiceに成功してもReviewが自動的に消えるわけではありません。",
  "Reference & pronunciation sources": "参照・発音ソース",
  "This area gathers the tools WLP can call on while you study. Provider-specific dictionary choices can grow here when those integrations are actually available.": "学習中にWLPから利用できる参照ツールをまとめます。辞書providerの選択は、実際に連携可能になった時点でここに追加できます。",
  "Open Links": "Linksを開く",
  "Current Study references": "現在のStudy参照",
  "Available from the card": "カードから利用可能",
  "Adjust Study reference tools": "Study参照ツールを調整",
  "Dictionary providers": "辞書provider",
  "Provider selection belongs here": "provider選択はここで管理",
  "Expandable": "拡張可能",
  "WLP does not currently have a verified multi-provider dictionary API layer to choose from here. When providers become available, this is where Primary Dictionary, Learning Layer source, thesaurus source, and similar defaults can be made explicit without crowding Study Options.": "現時点では、選択可能な複数辞書providerのAPI層はまだ確立していません。利用可能になったら、Primary Dictionary・Learning Layer source・Thesaurus sourceなどの既定値をStudy Optionsを混雑させずにここで設定できます。",
  "Ownership, backup & authoring": "所有・バックアップ・作成機能",
  "These are specialist tools, so Settings summarizes them and sends you to the dedicated workspace when deeper action is needed.": "専門的な機能はSettingsで状態と役割をまとめ、詳しい操作が必要なときは専用画面へ移動します。",
  "Backup & Restore": "バックアップ・復元",
  "Full Local Backup": "Full Local Backup",
  "Back up or restore browser-local WLP data": "ブラウザ内のWLPローカルデータをバックアップ・復元",
  "Authoring Transfer": "Authoring Transfer",
  "Drafts · Local Edits · Metadata": "Drafts · Local Edits · Metadata",
  "Move authoring layers without merging Study history": "Study履歴を統合せず作成レイヤーを移動",
  "Editor": "Editor",
  "New Cards, Drafts, Local Edits and authoring tools": "New Cards・Drafts・Local Editsなどの作成ツール",
  "Help": "ヘルプ",
  "Data model & terminology": "データモデル・用語",
  "Review how WLP separates Master, local layers and study state": "Master・local layers・study stateの分離を確認",
  "Your browser remains the working owner": "このブラウザが作業データの主体です",
  "Settings should expose and organize existing data controls, not create a second copy of the underlying Study, Progress, Practice, or authoring state.": "Settingsは既存のデータ管理を整理して見せる場所であり、Study・Progress・Practice・作成状態の別コピーを作りません。",
  "Vocabulary Map": "Vocabulary Map",
  "Review Attention": "Review Attention",
  "Learning Sources": "Learning Sources",
  "Next Move": "Next Move",
  "Recent Activity": "Recent Activity",
  "Overall Coverage": "Overall Coverage",
  "Deck Coverage Map": "Deck Coverage Map",
  "Practice Connections": "Practice Connections",
  "Learning Paths": "Learning Paths",
  "Focus for Today": "Focus for Today",
  "Recently Practiced": "Recently Practiced",
  "Paths Motto": "Paths Motto",
  "Time Window": "期間",
  "Evidence Source": "Evidence Source",
  "Activity Snapshot": "Activity Snapshot",
  "Activity Over Time": "Activity Over Time",
  "Activity Mix": "Activity Mix",
  "Timeline": "Timeline"
};
  const JA_GUIDANCE = {
  "title": "WLP全体の設定を俯瞰する場所です。各機能の意味を確認しながら、必要な設定はここでも変更できます。",
  "general": "WLP全体の土台となる設定と、各専門設定への入口をまとめています。",
  "study": "普段は右側のStudy Optionsで素早く操作し、ここでは同じ設定を整理された全体像として確認できます。",
  "practice": "Standard PracticeとAI Practiceの違い、既定モード、experience数などをまとめて確認できます。",
  "progress": "Progressの4つのビューがそれぞれ何を見るためのものかを整理し、表示パネルもここで調整できます。",
  "resources": "辞書・発音・外部参照など、学習中に使う情報源をまとめる領域です。",
  "data": "ローカルデータ、バックアップ、Authoring関連の入口をまとめています。",
  "language": "英語UIを維持したい場合でも、日本語の短い補助説明だけを追加できます。",
  "appearance": "テーマ・文字サイズ・表示密度など、WLP全体の見え方をまとめる場所です。",
  "access": "この端末のデータの持ち方と、現在のAdmin・作成機能の状態を確認できます。",
  "summaryStudy": "カード表示・音声・参照・移動など、Study Card周辺の設定です。",
  "summaryPractice": "Standard / AI Practiceの既定モードやセッション数を確認します。",
  "summaryProgress": "Progressの表示構成と、Reviewの注意度の考え方を確認します。",
  "summaryResources": "辞書・発音・外部参照など、学習中に使う情報源をまとめます。"
};

  Object.assign(JA_TEXT, {
    'Definition + Examples. Synonyms and Notes stay out of the way.':'DefinitionとExamplesを中心に表示し、SynonymsとNotesは控えめにします。',
    'Definition + Examples + Synonyms, with Notes collapsed until you need them.':'Definition・Examples・Synonymsを表示し、Notesは必要になるまで折りたたみます。',
    'Definition, Examples, Synonyms, and Notes all stay expanded.':'Definition・Examples・Synonyms・Notesをすべて展開表示します。',
    'Choose exactly what appears, collapses, or stays hidden.':'表示・折りたたみ・非表示を項目ごとに指定します。',
    'YouGlish · Hidden':'YouGlish · 非表示'
  });

  const STUDY_DEFAULTS = {
    contentPreset: 'standard',
    custom: { example:'shown', synonyms:'shown', notes:'collapsed', ipa:true, pos:true },
    youglish: { visible:true, accent:'us' },
    referenceTools: { external:true, google:true, images:true, jp:true },
    readAloud: {
      defaultTarget:'example',
      targets:{ definition:true, example:true, synonyms:true, notes:true, all:true }
    },
    display: { helperLabels:true, shuffle:true, recording:true },
    swipe:true
  };

  const PRESET_DESCRIPTIONS = {
    focus: 'Definition + Examples. Synonyms and Notes stay out of the way.',
    standard: 'Definition + Examples + Synonyms, with Notes collapsed until you need them.',
    full: 'Definition, Examples, Synonyms, and Notes all stay expanded.',
    custom: 'Choose exactly what appears, collapses, or stays hidden.'
  };

  const PROGRESS_OPTIONS = {
    Overview: [
      ['overview.map', 'Vocabulary Map'],
      ['overview.review', 'Review Attention'],
      ['overview.sources', 'Learning Sources'],
      ['overview.next', 'Next Move'],
      ['overview.recent', 'Recent Activity']
    ],
    Landscape: [
      ['landscape.coverage', 'Overall Coverage'],
      ['landscape.deckmap', 'Deck Coverage Map'],
      ['landscape.review', 'Review Attention'],
      ['landscape.connections', 'Practice Connections']
    ],
    Paths: [
      ['paths.paths', 'Learning Paths'],
      ['paths.focus', 'Focus for Today'],
      ['paths.recent', 'Recently Practiced'],
      ['paths.motto', 'Paths Motto']
    ],
    Activity: [
      ['activity.period', 'Time Window'],
      ['activity.source', 'Evidence Source'],
      ['activity.snapshot', 'Activity Snapshot'],
      ['activity.studyq', 'Standard Practice'],
      ['activity.ai', 'AI Practice'],
      ['activity.trend', 'Activity Over Time'],
      ['activity.mix', 'Activity Mix'],
      ['activity.timeline', 'Timeline']
    ]
  };

  const PREFERRED_VOICE_NAMES = [
    'Samantha','Karen','Victoria','Daniel','Alex','Oliver',
    'Microsoft Zira Desktop','Microsoft Aria','Microsoft David Desktop','Microsoft Guy'
  ];
  const NOVELTY_VOICE_RE = /\b(?:Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos?|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

  const $ = id => document.getElementById(id);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const safeParse = raw => { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } };

  let generalPrefs = loadGeneralPrefs();
  let studyPrefs = loadStudyPrefs();

  function loadGeneralPrefs() {
    const stored = safeParse(localStorage.getItem(GENERAL_SETTINGS_KEY));
    return {
      ...stored,
      languageMode: LANGUAGE_MODES.includes(stored.languageMode) ? stored.languageMode : 'en'
    };
  }

  function saveGeneralPrefs() {
    const stored = safeParse(localStorage.getItem(GENERAL_SETTINGS_KEY));
    generalPrefs = { ...stored, ...generalPrefs };
    localStorage.setItem(GENERAL_SETTINGS_KEY, JSON.stringify(generalPrefs));
    renderLanguageControls();
    applyLanguagePresentation();
  }

  function languageMode() {
    return LANGUAGE_MODES.includes(generalPrefs.languageMode) ? generalPrefs.languageMode : 'en';
  }

  function localizeDynamic(english) {
    return languageMode() === 'ja' ? (JA_TEXT[english] || english) : english;
  }

  function applyStaticLanguage() {
    const root = document.querySelector('.settings-main');
    if (!root) return;
    const japanese = languageMode() === 'ja';
    document.documentElement.lang = japanese ? 'ja' : 'en';
    document.title = japanese ? '設定 — WLP' : 'Settings — WLP';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.__wlpSettingsEnglish) node.__wlpSettingsEnglish = node.nodeValue;
      const original = node.__wlpSettingsEnglish;
      const trimmed = original.trim();
      if (!trimmed) continue;
      const replacement = japanese && JA_TEXT[trimmed] ? JA_TEXT[trimmed] : trimmed;
      node.nodeValue = original.replace(trimmed, replacement);
    }
    const languageChip = document.querySelector('.settings-language-card .settings-status-chip');
    const appearanceChip = document.querySelector('.settings-appearance-card .settings-status-chip');
    if (languageChip) languageChip.textContent = japanese ? '基本言語' : 'Foundation';
    if (appearanceChip) appearanceChip.textContent = japanese ? '基本設定' : 'Foundation';
  }

  function addGuidanceAfter(target, text, compact = false) {
    if (!target || !text) return;
    const note = document.createElement('p');
    note.className = `settings-ja-guidance${compact ? ' settings-ja-guidance-compact' : ''}`;
    note.lang = 'ja';
    note.textContent = text;
    target.insertAdjacentElement('afterend', note);
  }

  function findEnglishHeading(selector, text) {
    return $$(selector).find(node => node.textContent.trim() === text) || null;
  }

  function renderGuidance() {
    $$('.settings-ja-guidance').forEach(node => node.remove());
    if (languageMode() !== 'en-ja-guide') return;
    addGuidanceAfter(document.querySelector('.settings-title-row > div > p'), JA_GUIDANCE.title);
    ['general','study','practice','progress','resources','data'].forEach(key => {
      addGuidanceAfter(document.querySelector(`[data-settings-panel="${key}"] .settings-panel-head > p`), JA_GUIDANCE[key]);
    });
    addGuidanceAfter(document.querySelector('.settings-language-card > .settings-note'), JA_GUIDANCE.language);
    addGuidanceAfter(document.querySelector('.settings-appearance-card > .settings-note'), JA_GUIDANCE.appearance);
    addGuidanceAfter(document.querySelector('.settings-access-card .settings-readout-list'), JA_GUIDANCE.access);

    [
      ['study', JA_GUIDANCE.summaryStudy],
      ['practice', JA_GUIDANCE.summaryPractice],
      ['progress', JA_GUIDANCE.summaryProgress],
      ['resources', JA_GUIDANCE.summaryResources]
    ].forEach(([key, text]) => {
      const target = document.querySelector(`.settings-map-card[data-settings-jump="${key}"] small`);
      if (!target || !text) return;
      const note = document.createElement('small');
      note.className = 'settings-ja-guidance settings-ja-guidance-compact';
      note.lang = 'ja';
      note.textContent = text;
      target.insertAdjacentElement('afterend', note);
    });

    const studyGuidance = [
      ['How much of the back side is visible', 'カード裏面にどこまで情報を表示するかを選びます。'],
      ['Default Study Side', 'Studyを単語側・定義側のどちらから始めるかを設定します。'],
      ['What appears around the Study card', 'Study Card周辺に表示する補助操作を選びます。'],
      ['Voice & Read Aloud', 'Studyで使う音声とRead Aloudの既定動作をまとめます。'],
      ['Tools available from the Study card', 'Study Cardから使える参照・発音ツールを選びます。'],
      ['Moving through cards', 'カード間を移動する操作方法を設定します。']
    ];
    studyGuidance.forEach(([heading, text]) => {
      addGuidanceAfter(findEnglishHeading('[data-settings-panel="study"] .settings-card-head h3', heading), text, true);
    });

    const practiceGuidance = [
      ['Default mode', 'Study Hubを開いたときに最初に使うPracticeモードです。'],
      ['Standard Practice', 'AIを使わず、各experienceの結果を自分で評価するPracticeです。'],
      ['AI Practice', 'AIがexperienceを生成し、セッション数やHint数の既定値を使うPracticeです。']
    ];
    practiceGuidance.forEach(([heading, text]) => {
      addGuidanceAfter(findEnglishHeading('[data-settings-panel="practice"] .settings-card-head h3', heading), text, true);
    });

    const progressGuidance = {
      'Overview': '現在地・注意が必要な項目・次にすることをまとめて見るビューです。',
      'Landscape': '語彙全体のカバレッジや分布を見るビューです。',
      'Paths': 'Card / Standard / AIが作る学習経路を見るビューです。',
      'Activity': '実際に何をしたかを時間軸で見るビューです。'
    };
    Object.entries(progressGuidance).forEach(([heading, text]) => {
      const title = findEnglishHeading('[data-settings-panel="progress"] .settings-progress-intro strong', heading);
      addGuidanceAfter(title?.nextElementSibling, text, true);
    });

    addGuidanceAfter(
      document.querySelector('[data-settings-panel="progress"] .settings-review-note > .settings-note'),
      'Reviewは習熟度の点数ではなく、その項目に今後どれくらい注意を向けたいかを表します。Light / Medium / Highは、向けるべき注意度の度合いです。',
      true
    );
  }

  function renderLanguageControls() {
    const mode = languageMode();
    $$('[data-settings-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsLanguage === mode)));
    const description = $('settings-language-description');
    if (description) {
      description.textContent = mode === 'ja'
        ? 'SettingsのUIと説明を日本語で表示します。'
        : mode === 'en-ja-guide'
          ? 'English UIを保ち、各設定領域の意味を短い日本語ガイダンスで補います。'
          : 'English interface with English explanations.';
    }
  }

  function applyLanguagePresentation() {
    applyStaticLanguage();
    renderGuidance();
  }

  function bindLanguage() {
    $$('[data-settings-language]').forEach(button => button.addEventListener('click', () => {
      generalPrefs.languageMode = LANGUAGE_MODES.includes(button.dataset.settingsLanguage) ? button.dataset.settingsLanguage : 'en';
      saveGeneralPrefs();
    }));
  }

  function loadStudyPrefs() {
    const stored = safeParse(localStorage.getItem(STUDY_PREF_KEY));
    const custom = stored.custom && typeof stored.custom === 'object' ? stored.custom : {};
    return {
      contentPreset: ['focus','standard','full','custom'].includes(stored.contentPreset) ? stored.contentPreset : STUDY_DEFAULTS.contentPreset,
      custom: {
        example: ['shown','collapsed','hidden'].includes(custom.example) ? custom.example : STUDY_DEFAULTS.custom.example,
        synonyms: ['shown','collapsed','hidden'].includes(custom.synonyms) ? custom.synonyms : STUDY_DEFAULTS.custom.synonyms,
        notes: ['shown','collapsed','hidden'].includes(custom.notes) ? custom.notes : STUDY_DEFAULTS.custom.notes,
        ipa: typeof custom.ipa === 'boolean' ? custom.ipa : STUDY_DEFAULTS.custom.ipa,
        pos: typeof custom.pos === 'boolean' ? custom.pos : STUDY_DEFAULTS.custom.pos
      },
      youglish: {
        visible: typeof stored.youglish?.visible === 'boolean' ? stored.youglish.visible : STUDY_DEFAULTS.youglish.visible,
        accent: ['us','uk','aus'].includes(stored.youglish?.accent) ? stored.youglish.accent : STUDY_DEFAULTS.youglish.accent
      },
      referenceTools: {
        external: typeof stored.referenceTools?.external === 'boolean' ? stored.referenceTools.external : STUDY_DEFAULTS.referenceTools.external,
        google: typeof stored.referenceTools?.google === 'boolean' ? stored.referenceTools.google : STUDY_DEFAULTS.referenceTools.google,
        images: typeof stored.referenceTools?.images === 'boolean' ? stored.referenceTools.images : STUDY_DEFAULTS.referenceTools.images,
        jp: typeof stored.referenceTools?.jp === 'boolean' ? stored.referenceTools.jp : STUDY_DEFAULTS.referenceTools.jp
      },
      readAloud: {
        defaultTarget: ['definition','example','synonyms','notes'].includes(stored.readAloud?.defaultTarget) ? stored.readAloud.defaultTarget : STUDY_DEFAULTS.readAloud.defaultTarget,
        targets: {
          definition: typeof stored.readAloud?.targets?.definition === 'boolean' ? stored.readAloud.targets.definition : STUDY_DEFAULTS.readAloud.targets.definition,
          example: typeof stored.readAloud?.targets?.example === 'boolean' ? stored.readAloud.targets.example : STUDY_DEFAULTS.readAloud.targets.example,
          synonyms: typeof stored.readAloud?.targets?.synonyms === 'boolean' ? stored.readAloud.targets.synonyms : STUDY_DEFAULTS.readAloud.targets.synonyms,
          notes: typeof stored.readAloud?.targets?.notes === 'boolean' ? stored.readAloud.targets.notes : STUDY_DEFAULTS.readAloud.targets.notes,
          all: typeof stored.readAloud?.targets?.all === 'boolean' ? stored.readAloud.targets.all : STUDY_DEFAULTS.readAloud.targets.all
        }
      },
      display: {
        helperLabels: typeof stored.display?.helperLabels === 'boolean' ? stored.display.helperLabels : STUDY_DEFAULTS.display.helperLabels,
        shuffle: typeof stored.display?.shuffle === 'boolean' ? stored.display.shuffle : STUDY_DEFAULTS.display.shuffle,
        recording: typeof stored.display?.recording === 'boolean' ? stored.display.recording : STUDY_DEFAULTS.display.recording
      },
      swipe: typeof stored.swipe === 'boolean' ? stored.swipe : STUDY_DEFAULTS.swipe
    };
  }

  function saveStudyPrefs() {
    const stored = safeParse(localStorage.getItem(STUDY_PREF_KEY));
    const merged = {
      ...stored,
      ...studyPrefs,
      custom: { ...(stored.custom || {}), ...studyPrefs.custom },
      youglish: { ...(stored.youglish || {}), ...studyPrefs.youglish },
      referenceTools: { ...(stored.referenceTools || {}), ...studyPrefs.referenceTools },
      readAloud: {
        ...(stored.readAloud || {}),
        ...studyPrefs.readAloud,
        targets: { ...(stored.readAloud?.targets || {}), ...studyPrefs.readAloud.targets }
      },
      display: { ...(stored.display || {}), ...studyPrefs.display }
    };
    localStorage.setItem(STUDY_PREF_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('wlp:study-options-changed'));
    renderStudy();
    renderSummaries();
    renderResources();
  }

  function activeSectionFromHash() {
    const key = String(location.hash || '').replace(/^#/, '').toLowerCase();
    return ['general','study','practice','progress','resources','data'].includes(key) ? key : 'general';
  }

  function showSection(section, pushHash = true) {
    const safe = ['general','study','practice','progress','resources','data'].includes(section) ? section : 'general';
    $$('[data-settings-section]').forEach(button => button.classList.toggle('is-active', button.dataset.settingsSection === safe));
    $$('[data-settings-panel]').forEach(panel => {
      const active = panel.dataset.settingsPanel === safe;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    if (pushHash && location.hash !== `#${safe}`) history.replaceState(null, '', `#${safe}`);
    window.scrollTo({ top:0, behavior:'auto' });
  }

  function currentRole() {
    return localStorage.getItem(ROLE_KEY) === 'admin' || sessionStorage.getItem(SESSION_ROLE_KEY) === 'admin' ? 'admin' : 'guest';
  }

  function renderRole() {
    const admin = currentRole() === 'admin';
    if ($('settings-role-chip')) $('settings-role-chip').textContent = admin ? 'Admin' : 'Guest';
    if ($('settings-authoring-state')) $('settings-authoring-state').textContent = admin ? 'Available in Admin mode' : 'Locked in Guest mode';
    if ($('settings-editor-access')) $('settings-editor-access').textContent = admin ? 'Admin mode available' : 'Admin access required';
    applyLanguagePresentation();
  }

  function currentStudyMode() {
    return localStorage.getItem(CARD_MODE_KEY) === 'definition' ? 'definition' : 'word';
  }

  function renderStudy() {
    studyPrefs = loadStudyPrefs();
    $$('[data-settings-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsPreset === studyPrefs.contentPreset)));
    if ($('study-preset-value')) $('study-preset-value').textContent = studyPrefs.contentPreset.charAt(0).toUpperCase() + studyPrefs.contentPreset.slice(1);
    if ($('study-preset-description')) $('study-preset-description').textContent = PRESET_DESCRIPTIONS[studyPrefs.contentPreset] || '';
    if ($('study-custom-panel')) $('study-custom-panel').hidden = studyPrefs.contentPreset !== 'custom';
    $$('[data-settings-custom]').forEach(select => { select.value = studyPrefs.custom[select.dataset.settingsCustom]; });
    $$('[data-settings-detail]').forEach(input => { input.checked = Boolean(studyPrefs.custom[input.dataset.settingsDetail]); });

    const mode = currentStudyMode();
    $$('[data-settings-side]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsSide === mode)));
    if ($('study-side-value')) $('study-side-value').textContent = mode === 'definition' ? 'Definition First' : 'Word First';

    $$('[data-settings-display]').forEach(input => { input.checked = Boolean(studyPrefs.display[input.dataset.settingsDisplay]); });
    $$('[data-settings-reference]').forEach(input => { input.checked = Boolean(studyPrefs.referenceTools[input.dataset.settingsReference]); });
    $$('[data-settings-read-target]').forEach(input => { input.checked = Boolean(studyPrefs.readAloud.targets[input.dataset.settingsReadTarget]); });
    if ($('settings-read-default')) $('settings-read-default').value = studyPrefs.readAloud.defaultTarget;
    if ($('settings-youglish-visible')) $('settings-youglish-visible').checked = studyPrefs.youglish.visible;
    $$('[data-settings-accent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsAccent === studyPrefs.youglish.accent)));
    if ($('youglish-value')) $('youglish-value').textContent = studyPrefs.youglish.visible ? `YouGlish · ${studyPrefs.youglish.accent === 'aus' ? 'AU' : studyPrefs.youglish.accent.toUpperCase()}` : 'YouGlish · Hidden';
    if ($('settings-swipe')) $('settings-swipe').checked = studyPrefs.swipe;
    renderVoiceSelect();
    applyLanguagePresentation();
  }

  function voiceLabel(voice) {
    if (!voice) return 'System default';
    const locale = String(voice.lang || '').replace('_','-');
    const match = locale.match(/^en-([A-Za-z]{2})$/i);
    let region = locale;
    if (match) {
      const code = match[1].toUpperCase();
      region = ({US:'US',GB:'UK',AU:'AU',CA:'CA',IE:'IE',NZ:'NZ',IN:'IN',ZA:'ZA'})[code] || code;
    }
    return region ? `${voice.name} · ${region}` : voice.name;
  }

  function availableStudyVoices() {
    if (!('speechSynthesis' in window)) return [];
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return [];
    const preferred = [];
    PREFERRED_VOICE_NAMES.forEach(name => {
      const exact = voices.find(v => v?.name === name && /^en(?:-|_)/i.test(v.lang || ''));
      if (exact) preferred.push(exact);
    });
    if (preferred.length) return preferred;
    const counts = new Map();
    voices.forEach(v => { if (v?.name) counts.set(v.name, (counts.get(v.name) || 0) + 1); });
    const seen = new Set();
    return voices.filter(v => {
      if (!v?.name || !/^en(?:-|_)/i.test(v.lang || '')) return false;
      if (NOVELTY_VOICE_RE.test(v.name)) return false;
      if ((counts.get(v.name) || 0) > 1 || seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    }).slice(0, 8);
  }

  function renderVoiceSelect() {
    const select = $('settings-study-voice');
    if (!select) return;
    const current = localStorage.getItem(VOICE_KEY) || '';
    const voices = availableStudyVoices();
    const options = ['<option value="">System default</option>'];
    voices.forEach(voice => options.push(`<option value="${escapeAttr(voice.name)}">${escapeHtml(voiceLabel(voice))}</option>`));
    if (current && !voices.some(v => v.name === current)) options.push(`<option value="${escapeAttr(current)}">${escapeHtml(current)} · saved</option>`);
    select.innerHTML = options.join('');
    select.value = current;
    applyLanguagePresentation();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function escapeAttr(value) { return escapeHtml(value); }

  function readProgressPrefs() {
    const parsed = safeParse(localStorage.getItem(PROGRESS_OPTIONS_KEY));
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function renderProgressOptions() {
    const host = $('settings-progress-options');
    if (!host) return;
    const saved = readProgressPrefs();
    host.innerHTML = Object.entries(PROGRESS_OPTIONS).map(([group, items]) => `
      <section class="settings-progress-group">
        <h3>${escapeHtml(group)}</h3>
        ${items.map(([key,label]) => `<label class="settings-switch-row"><span><strong>${escapeHtml(label)}</strong></span><input type="checkbox" data-settings-progress-option="${escapeAttr(key)}" ${saved[key] === false ? '' : 'checked'}></label>`).join('')}
      </section>`).join('');
    $$('[data-settings-progress-option]').forEach(input => input.addEventListener('change', () => {
      const next = readProgressPrefs();
      next[input.dataset.settingsProgressOption] = input.checked;
      localStorage.setItem(PROGRESS_OPTIONS_KEY, JSON.stringify(next));
      renderSummaries();
    }));
    applyLanguagePresentation();
  }

  function renderPractice() {
    const mode = localStorage.getItem(PRACTICE_MODE_KEY) === 'ai' ? 'ai' : 'standard';
    if ($('settings-practice-mode')) $('settings-practice-mode').value = mode;
    if ($('practice-mode-value')) $('practice-mode-value').textContent = mode === 'ai' ? 'AI Practice' : 'Standard Practice';

    const standard = Number(localStorage.getItem(STANDARD_SIZE_KEY));
    if ($('settings-standard-size')) $('settings-standard-size').value = [1,3,5,10,20].includes(standard) ? String(standard) : '';
    const ai = Number(localStorage.getItem(AI_SIZE_KEY));
    if ($('settings-ai-size')) $('settings-ai-size').value = [1,3,5,10,20].includes(ai) ? String(ai) : '';
    const hintRaw = localStorage.getItem(AI_HINT_KEY);
    const hints = hintRaw == null ? 4 : Number(hintRaw);
    if ($('settings-ai-hints')) $('settings-ai-hints').value = [0,2,4,6].includes(hints) ? String(hints) : '4';
    applyLanguagePresentation();
  }

  function renderResources() {
    const host = $('settings-resource-readout');
    if (!host) return;
    const entries = [
      ['External Reference', studyPrefs.referenceTools.external],
      ['Google', studyPrefs.referenceTools.google],
      ['Images', studyPrefs.referenceTools.images],
      ['JP Reference', studyPrefs.referenceTools.jp],
      [`YouGlish · ${studyPrefs.youglish.accent === 'aus' ? 'AU' : studyPrefs.youglish.accent.toUpperCase()}`, studyPrefs.youglish.visible]
    ];
    host.innerHTML = entries.map(([label,on]) => `<div class="settings-resource-pill"><span>${escapeHtml(label)}</span><em>${on ? 'Shown' : 'Hidden'}</em></div>`).join('');
    const count = entries.filter(([,on]) => on).length;
    if ($('resources-reference-count')) $('resources-reference-count').textContent = languageMode() === 'ja' ? `${count}件有効` : `${count} enabled`;
    applyLanguagePresentation();
  }

  function renderSummaries() {
    const mode = currentStudyMode();
    const preset = studyPrefs.contentPreset.charAt(0).toUpperCase() + studyPrefs.contentPreset.slice(1);
    if ($('summary-study')) $('summary-study').textContent = languageMode() === 'ja'
      ? `${JA_TEXT[preset] || preset} · ${mode === 'definition' ? '定義から' : '単語から'}`
      : `${preset} · ${mode === 'definition' ? 'Definition First' : 'Word First'}`;
    const practiceMode = localStorage.getItem(PRACTICE_MODE_KEY) === 'ai' ? 'AI Practice' : 'Standard Practice';
    if ($('summary-practice')) $('summary-practice').textContent = practiceMode;
    const progressSaved = readProgressPrefs();
    const hiddenCount = Object.values(progressSaved).filter(value => value === false).length;
    if ($('summary-progress')) $('summary-progress').textContent = hiddenCount
      ? (languageMode() === 'ja' ? `${hiddenCount}パネル非表示` : `${hiddenCount} panel${hiddenCount === 1 ? '' : 's'} hidden`)
      : localizeDynamic('Default dashboard');
    if ($('summary-resources')) $('summary-resources').textContent = studyPrefs.youglish.visible ? `YouGlish · ${studyPrefs.youglish.accent === 'aus' ? 'AU' : studyPrefs.youglish.accent.toUpperCase()}` : (languageMode() === 'ja' ? 'YouGlish 非表示' : 'YouGlish hidden');
    applyLanguagePresentation();
  }

  function bindStudy() {
    $$('[data-settings-preset]').forEach(button => button.addEventListener('click', () => {
      studyPrefs.contentPreset = button.dataset.settingsPreset;
      saveStudyPrefs();
    }));
    $$('[data-settings-custom]').forEach(select => select.addEventListener('change', () => {
      studyPrefs.custom[select.dataset.settingsCustom] = select.value;
      saveStudyPrefs();
    }));
    $$('[data-settings-detail]').forEach(input => input.addEventListener('change', () => {
      studyPrefs.custom[input.dataset.settingsDetail] = input.checked;
      saveStudyPrefs();
    }));
    $$('[data-settings-side]').forEach(button => button.addEventListener('click', () => {
      localStorage.setItem(CARD_MODE_KEY, button.dataset.settingsSide === 'definition' ? 'definition' : 'word');
      window.dispatchEvent(new CustomEvent('wlp:study-options-changed'));
      renderStudy();
      renderSummaries();
    }));
    $$('[data-settings-display]').forEach(input => input.addEventListener('change', () => {
      studyPrefs.display[input.dataset.settingsDisplay] = input.checked;
      saveStudyPrefs();
    }));
    $$('[data-settings-reference]').forEach(input => input.addEventListener('change', () => {
      studyPrefs.referenceTools[input.dataset.settingsReference] = input.checked;
      saveStudyPrefs();
    }));
    $$('[data-settings-read-target]').forEach(input => input.addEventListener('change', () => {
      const key = input.dataset.settingsReadTarget;
      if (key === 'all') {
        studyPrefs.readAloud.targets.all = input.checked;
      } else {
        const keys = ['definition','example','synonyms','notes'];
        const next = { ...studyPrefs.readAloud.targets, [key]:input.checked };
        if (!keys.some(candidate => next[candidate])) {
          input.checked = true;
          return;
        }
        studyPrefs.readAloud.targets[key] = input.checked;
        if (!studyPrefs.readAloud.targets[studyPrefs.readAloud.defaultTarget]) {
          studyPrefs.readAloud.defaultTarget = keys.find(candidate => studyPrefs.readAloud.targets[candidate]) || 'example';
        }
      }
      saveStudyPrefs();
    }));
    $('settings-read-default')?.addEventListener('change', event => {
      const key = event.target.value;
      if (!studyPrefs.readAloud.targets[key]) studyPrefs.readAloud.targets[key] = true;
      studyPrefs.readAloud.defaultTarget = key;
      saveStudyPrefs();
    });
    $('settings-youglish-visible')?.addEventListener('change', event => {
      studyPrefs.youglish.visible = event.target.checked;
      saveStudyPrefs();
    });
    $$('[data-settings-accent]').forEach(button => button.addEventListener('click', () => {
      studyPrefs.youglish.accent = button.dataset.settingsAccent;
      saveStudyPrefs();
    }));
    $('settings-swipe')?.addEventListener('change', event => {
      studyPrefs.swipe = event.target.checked;
      saveStudyPrefs();
    });
    $('settings-study-voice')?.addEventListener('change', event => {
      localStorage.setItem(VOICE_KEY, event.target.value || '');
      window.dispatchEvent(new CustomEvent('wlp:study-options-changed'));
      renderVoiceSelect();
    });
    $('open-study-options')?.addEventListener('click', () => window.WLPStudyOptions?.open?.());
  }

  function bindPractice() {
    $('settings-practice-mode')?.addEventListener('change', event => {
      const value = event.target.value === 'ai' ? 'ai' : 'standard';
      localStorage.setItem(PRACTICE_MODE_KEY, value);
      renderPractice();
      renderSummaries();
    });
    $('settings-standard-size')?.addEventListener('change', event => {
      const value = Number(event.target.value);
      if ([1,3,5,10,20].includes(value)) localStorage.setItem(STANDARD_SIZE_KEY, String(value));
      else localStorage.removeItem(STANDARD_SIZE_KEY);
      renderPractice();
    });
    $('settings-ai-size')?.addEventListener('change', event => {
      const value = Number(event.target.value);
      if ([1,3,5,10,20].includes(value)) localStorage.setItem(AI_SIZE_KEY, String(value));
      else localStorage.removeItem(AI_SIZE_KEY);
      renderPractice();
    });
    $('settings-ai-hints')?.addEventListener('change', event => {
      const value = Number(event.target.value);
      localStorage.setItem(AI_HINT_KEY, String([0,2,4,6].includes(value) ? value : 4));
      renderPractice();
    });
  }

  function init() {
    $$('[data-settings-section]').forEach(button => button.addEventListener('click', () => showSection(button.dataset.settingsSection)));
    $$('[data-settings-jump]').forEach(button => button.addEventListener('click', () => showSection(button.dataset.settingsJump)));
    window.addEventListener('hashchange', () => showSection(activeSectionFromHash(), false));

    bindLanguage();
    bindStudy();
    bindPractice();
    renderLanguageControls();
    renderStudy();
    renderPractice();
    renderProgressOptions();
    renderResources();
    renderRole();
    renderSummaries();
    showSection(activeSectionFromHash(), false);
    applyLanguagePresentation();

    $('settings-progress-reset')?.addEventListener('click', () => {
      localStorage.removeItem(PROGRESS_OPTIONS_KEY);
      renderProgressOptions();
      renderSummaries();
    });

    window.addEventListener('wlp:study-options-changed', () => {
      studyPrefs = loadStudyPrefs();
      renderStudy();
      renderResources();
      renderSummaries();
    });
    window.addEventListener('storage', () => {
      generalPrefs = loadGeneralPrefs();
      studyPrefs = loadStudyPrefs();
      renderStudy();
      renderPractice();
      renderProgressOptions();
      renderResources();
      renderRole();
      renderLanguageControls();
      renderSummaries();
      applyLanguagePresentation();
    });

    const roleLabel = $('role-label');
    if (roleLabel) new MutationObserver(() => { renderRole(); }).observe(roleLabel, { childList:true, subtree:true, characterData:true });

    if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', renderVoiceSelect);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
