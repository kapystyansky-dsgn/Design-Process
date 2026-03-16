figma.showUI(__html__, { width: 440, height: 620 });

// --- Extract DS tokens and send to UI ---

async function sendDSTokens() {
  const tokens: { fontFamily?: string; colors: Array<{ name: string; hex: string }> } = { colors: [] };

  try {
    const paintStyles = figma.getLocalPaintStyles();
    for (const style of paintStyles) {
      const paint = style.paints[0];
      if (paint && paint.type === 'SOLID') {
        const r = Math.round(paint.color.r * 255);
        const g = Math.round(paint.color.g * 255);
        const b = Math.round(paint.color.b * 255);
        const hex = '#' + [r, g, b].map(v => { const s = v.toString(16); return s.length < 2 ? '0' + s : s; }).join('');
        tokens.colors.push({ name: style.name, hex });
      }
    }

    const textStyles = figma.getLocalTextStyles();
    if (textStyles.length > 0) {
      const firstFont = textStyles[0].fontName;
      if (firstFont && typeof firstFont === 'object' && 'family' in firstFont) {
        tokens.fontFamily = firstFont.family;
      }
    }
  } catch (_e) {
    // DS tokens optional — ignore errors
  }

  figma.ui.postMessage({ type: 'ds-tokens', tokens });
}

sendDSTokens();

type UxAuditReport = {
  summaryShort?: string;
  score?: number;
  cognitiveWalkthrough?: Array<{ screen?: string; step?: string; userQuestion?: string; clarity?: string; note?: string }>;
  multiRoleFindings?: Array<{ role?: string; screen?: string; element?: string; finding?: string; suggestion?: string }>;
  nielsenAudit?: Array<{ heuristic?: string; screen?: string; score?: number; element?: string; note?: string }>;
  usabilityHypotheses?: Array<{ screen?: string; hypothesis?: string; impact?: number; confidence?: number; ease?: number; iceScore?: number; affectedMetric?: string }>;
  quickWins?: string[];
  inclusivityTips?: string[];
};

type FormatFileMessage = { type: 'format-file'; payload?: { fallback?: boolean; error?: string; componentKeys?: string[] } };
type CheckUxMessage = { type: 'check-ux' };
type PutReportOnCanvasMessage = { type: 'put-report-on-canvas'; payload?: { report: UxAuditReport; featureName?: string } };
type CheckDesignSystemMessage = { type: 'check-design-system' };
type CloseMessage = { type: 'close' };

type IncomingMessage = FormatFileMessage | CheckUxMessage | PutReportOnCanvasMessage | CheckDesignSystemMessage | CloseMessage;

// --- Local Design System Check (no AI, no PNG, no HTTP) ---

type LocalDsIssueType =
  | 'NON_SYSTEM_COMPONENT'
  | 'NON_SYSTEM_COLOR'
  | 'NON_SYSTEM_TEXT_STYLE'
  | 'SMALL_TOUCH_TARGET'
  | 'SMALL_TEXT'
  | 'MISSING_LABEL';

type LocalDsIssue = {
  type: LocalDsIssueType;
  nodeId: string;
  nodeName: string;
  description: string;
  recommendation: string;
};

type LocalDsReport = {
  issues: LocalDsIssue[];
  summary: string;
};

const MIN_TOUCH_TARGET_PX = 44;
const MIN_TEXT_SIZE_PX = 12;

function runLocalDesignSystemCheck(selection: readonly SceneNode[]): LocalDsReport {
  const issues: LocalDsIssue[] = [];

  let allowedPaintStyleIds: string[] = [];
  let allowedTextStyleIds: string[] = [];
  let allowedComponentIds: string[] = [];

  try {
    allowedPaintStyleIds = figma.getLocalPaintStyles().map((s) => s.id);
    allowedTextStyleIds = figma.getLocalTextStyles().map((s) => s.id);
    const componentNodes = figma.currentPage.findAll((n) => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
    const ids = new Set<string>();
    for (const n of componentNodes) {
      if (n.type === 'COMPONENT') ids.add(n.id);
      else if (n.type === 'COMPONENT_SET' && 'children' in n)
        for (const c of n.children) ids.add(c.id);
    }
    allowedComponentIds = Array.from(ids);
  } catch (_e) {
    // use empty lists if unavailable
  }

  function addIssue(type: LocalDsIssueType, node: SceneNode, description: string, recommendation: string) {
    issues.push({
      type,
      nodeId: node.id,
      nodeName: node.name,
      description,
      recommendation,
    });
  }

  function walk(node: SceneNode) {
    const nameLower = node.name.toLowerCase();
    const isInteractive =
      nameLower.includes('button') ||
      nameLower.includes('btn') ||
      nameLower.includes('кнопк') ||
      nameLower.includes('cta') ||
      nameLower.includes('icon') ||
      nameLower.includes('иконк') ||
      nameLower.includes('input') ||
      nameLower.includes('field') ||
      nameLower.includes('поле') ||
      ('reactions' in node && Array.isArray((node as any).reactions) && (node as any).reactions.length > 0);

    if (node.type === 'TEXT') {
      const tn = node as TextNode;
      const fontSize = typeof tn.fontSize === 'number' ? tn.fontSize : 0;
      if (fontSize > 0 && fontSize < MIN_TEXT_SIZE_PX) {
        addIssue(
          'SMALL_TEXT',
          node,
          `Текст меньше ${MIN_TEXT_SIZE_PX}px (${fontSize}px) — снижает читаемость и доступность.`,
          `Увеличить размер шрифта до минимум ${MIN_TEXT_SIZE_PX}px.`
        );
      }
      if (allowedTextStyleIds.length > 0 && 'textStyleId' in tn) {
        const styleId = (tn as any).textStyleId;
        if (typeof styleId === 'string' && allowedTextStyleIds.indexOf(styleId) === -1) {
          addIssue(
            'NON_SYSTEM_TEXT_STYLE',
            node,
            'Использован типографический стиль вне дизайн-системы.',
            'Применить один из локальных текстовых стилей файла.'
          );
        }
      }
    }

    if (node.type === 'INSTANCE' && allowedComponentIds.length > 0) {
      const inst = node as InstanceNode;
      const mainId = inst.mainComponent?.id;
      if (mainId && allowedComponentIds.indexOf(mainId) === -1) {
        addIssue(
          'NON_SYSTEM_COMPONENT',
          node,
          'Компонент не из списка допустимых компонент дизайн-системы.',
          'Заменить на компонент из библиотеки дизайн-системы или добавить в допустимые.'
        );
      }
    }

    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      if (allowedComponentIds.length > 0 && allowedComponentIds.indexOf(node.id) === -1) {
        addIssue(
          'NON_SYSTEM_COMPONENT',
          node,
          'Компонент не в списке локальных компонент дизайн-системы.',
          'Использовать компонент из библиотеки или добавить в допустимые.'
        );
      }
    }

    if ('fills' in node && allowedPaintStyleIds.length > 0) {
      const fillStyleId = (node as any).fillStyleId;
      if (typeof fillStyleId === 'string' && allowedPaintStyleIds.indexOf(fillStyleId) === -1) {
        addIssue(
          'NON_SYSTEM_COLOR',
          node,
          'Заливка не использует стиль из дизайн-системы.',
          'Применить цветовой токен (локальный paint style).'
        );
      }
    }

    if (isInteractive && 'width' in node && 'height' in node) {
      const w = (node as any).width as number;
      const h = (node as any).height as number;
      if (typeof w === 'number' && typeof h === 'number' && (w < MIN_TOUCH_TARGET_PX || h < MIN_TOUCH_TARGET_PX)) {
        addIssue(
          'SMALL_TOUCH_TARGET',
          node,
          `Интерактивная область ${Math.round(w)}×${Math.round(h)}px меньше рекомендуемых ${MIN_TOUCH_TARGET_PX}px.`,
          `Увеличить область нажатия до минимум ${MIN_TOUCH_TARGET_PX}×${MIN_TOUCH_TARGET_PX}px.`
        );
      }
      const hasLabel =
        (node.type === 'TEXT' && (node as TextNode).characters.trim().length > 0) ||
        nameLower.length > 2 ||
        (node as any).findAll?.((c: SceneNode) => c.type === 'TEXT')?.length > 0;
      if (!hasLabel) {
        addIssue(
          'MISSING_LABEL',
          node,
          'Интерактивный элемент без видимого текстового лейбла.',
          'Добавить текст или aria-label для доступности.'
        );
      }
    }

    if ('children' in node) {
      for (const child of node.children as readonly SceneNode[]) walk(child);
    }
  }

  for (const node of selection) walk(node);

  const critical = issues.filter(
    (i) => i.type === 'SMALL_TOUCH_TARGET' || i.type === 'SMALL_TEXT' || i.type === 'MISSING_LABEL'
  ).length;
  const style = issues.filter(
    (i) =>
      i.type === 'NON_SYSTEM_COMPONENT' || i.type === 'NON_SYSTEM_COLOR' || i.type === 'NON_SYSTEM_TEXT_STYLE'
  ).length;
  let summary: string;
  if (issues.length === 0) {
    summary = 'Нарушений не найдено. Выделение соответствует проверенным правилам дизайн-системы и доступности.';
  } else {
    summary = `Найдено нарушений: ${issues.length}. Критичные (доступность): ${critical}. Стили/компоненты: ${style}.`;
  }

  return { issues, summary };
}

type AiReport = {
  score: number;
  featureOverview?: string;
  flowEvaluation?: string;
  designSystemSection?: string;
  textsSection?: string;
  jtbd?: string;
  uxSummary?: string;
  researchInsights?: string[];
  top4Problems?: Array<{ title: string; where: string; why: string; metric?: string; action: string }>;
  top3Problems?: Array<{ title: string; where: string; why: string; action: string }>;
  quickWins: string[];
  inclusivity?: string[];
  inclusivityTips?: string[];
  targetUXState?: string;
  summaryShort?: string;
};

const NNGROUP_BASE = 'https://www.nngroup.com';

const REFERENCE_PORTALS = [
  { name: 'Benchmarkee', url: 'https://benchmarkee.ru/', description: 'UX-паттерны мобильных приложений (РФ/СНГ)' },
  { name: 'Page Flows', url: 'https://pageflows.com/', description: 'User flows и экраны приложений' },
  { name: 'Scrn.gallery', url: 'https://scrn.gallery/patterns', description: 'UX/UI референсы и паттерны' },
] as const;

function getPortalHintsForFeature(featureName: string | null): Array<{ name: string; url: string; hint: string }> {
  const lower = (featureName ?? '').toLowerCase();
  const hints: Record<string, string> = {};

  if (/\b(вход|логин|авторизация|auth|login)\b/.test(lower)) {
    hints['Benchmarkee'] = 'Финансы, Транспорт — экраны входа';
    hints['Page Flows'] = 'Login, Logging In, Sign Up';
    hints['Scrn.gallery'] = 'паттерны входа и аутентификации';
  }
  if (/\b(заказ|оформление|корзина|checkout|оплата|покупка)\b/.test(lower)) {
    hints['Benchmarkee'] = 'Еда и продукты — оформление заказа';
    hints['Page Flows'] = 'Checkout, Purchasing, Commerce & Payments';
    hints['Scrn.gallery'] = 'паттерны корзины и оплаты';
  }
  if (/\b(онбординг|приветствие|обучение|tutorial)\b/.test(lower)) {
    hints['Benchmarkee'] = 'первые экраны приложений';
    hints['Page Flows'] = 'Onboarding, Signing Up, Tutorials';
    hints['Scrn.gallery'] = 'паттерны онбординга';
  }
  if (/\b(регистрация|sign up)\b/.test(lower)) {
    hints['Benchmarkee'] = 'экраны регистрации';
    hints['Page Flows'] = 'Sign Up, Signing Up, Verifying';
    hints['Scrn.gallery'] = 'паттерны регистрации';
  }
  if (/\b(профиль|настройки|аккаунт|profile|settings)\b/.test(lower)) {
    hints['Benchmarkee'] = 'профиль и настройки';
    hints['Page Flows'] = 'Editing Profile, Account Management';
    hints['Scrn.gallery'] = 'паттерны профиля и настроек';
  }
  if (/\b(поиск|search|фильтр)\b/.test(lower)) {
    hints['Benchmarkee'] = 'поиск и каталоги';
    hints['Page Flows'] = 'Search, Filtering & Sorting';
    hints['Scrn.gallery'] = 'паттерны поиска и фильтров';
  }

  const defaults: Record<string, string> = {
    'Benchmarkee': 'сверьте структуру экрана по категориям',
    'Page Flows': 'сверьте шаги и CTA по User Flows',
    'Scrn.gallery': 'сверьте визуал и флоу по паттернам',
  };

  return REFERENCE_PORTALS.map((p) => ({
    name: p.name,
    url: p.url,
    hint: hints[p.name] ?? defaults[p.name] ?? 'изучите флоу для своего сценария',
  }));
}

// --- DESIGN_JSON (Figma API structure for AI, no image) ---

type DesignJsonFeature = {
  name: string;
  scenario: string;
  business_goals: string[];
  success_metrics: string[];
  user_pains: string[];
};

type DesignJsonText = {
  id: string;
  content: string;
  semantic_role: 'title' | 'subtitle' | 'cta' | 'label' | 'helper' | 'error' | 'body';
  font_size: number | null;
};

type DesignJsonAction = {
  id: string;
  label: string;
  kind: 'primary' | 'secondary' | 'link' | 'icon';
  target_frame_id: string | null;
};

type DesignJsonFrame = {
  id: string;
  name: string;
  role: 'screen' | 'modal' | 'step' | 'summary';
  texts: DesignJsonText[];
  actions: DesignJsonAction[];
};

type DesignJsonFlowAccessibility = {
  small_touch_targets?: boolean;
  small_text?: boolean;
  inconsistent_typography?: boolean;
  non_system_colors?: boolean;
  other?: string[];
};

type DesignJson = {
  feature: DesignJsonFeature;
  flow: {
    start_frame_id: string;
    frames: DesignJsonFrame[];
    accessibility_flags?: DesignJsonFlowAccessibility;
  };
};

const MAX_RELATED_FRAMES = 20;
const MAX_FRAME_DEPTH = 3;

function inferFrameRole(name: string): DesignJsonFrame['role'] {
  const n = name.toLowerCase();
  if (/\b(modal|dialog|popup|overlay)\b/.test(n)) return 'modal';
  if (/\b(step|шаг)\b/.test(n)) return 'step';
  if (/\b(summary|result|итог|результат)\b/.test(n)) return 'summary';
  return 'screen';
}

function inferTextRole(node: TextNode, parentName: string): DesignJsonText['semantic_role'] {
  const name = node.name.toLowerCase();
  const parent = parentName.toLowerCase();
  if (/\b(title|заголовок|heading)\b/.test(name) || /\b(title|heading)\b/.test(parent)) return 'title';
  if (/\b(subtitle|подзаголовок)\b/.test(name) || /\b(subtitle)\b/.test(parent)) return 'subtitle';
  if (/\b(cta|button|кнопк|btn)\b/.test(parent)) return 'cta';
  if (/\b(label|подпис|label)\b/.test(name)) return 'label';
  if (/\b(helper|hint|подсказ|placeholder)\b/.test(name)) return 'helper';
  if (/\b(error|ошибк)\b/.test(name)) return 'error';
  const fontSize = typeof node.fontSize === 'number' ? node.fontSize : 0;
  if (fontSize >= 20) return 'title';
  if (fontSize >= 16) return 'subtitle';
  return 'body';
}

function inferActionKind(name: string, hasOnlyIcon: boolean): DesignJsonAction['kind'] {
  const n = name.toLowerCase();
  if (hasOnlyIcon || /\b(icon|иконк)\b/.test(n)) return 'icon';
  if (/\b(link|ссылка)\b/.test(n)) return 'link';
  if (/\b(primary|main|основн|cta)\b/.test(n)) return 'primary';
  return 'secondary';
}

function getTargetFrameId(node: SceneNode): string | null {
  if (!('reactions' in node) || !Array.isArray((node as any).reactions)) return null;
  const reactions = (node as any).reactions as Array<{ actions?: Array<{ type?: string; destinationId?: string | null }> }>;
  for (const r of reactions) {
    const actions = r.actions ?? (r as any).action ? [(r as any).action] : [];
    for (const a of actions) {
      if (a && (a.type === 'NODE' || (a as any).destinationId != null) && (a as any).destinationId) {
        return String((a as any).destinationId);
      }
    }
  }
  return null;
}

function getTextLabel(node: SceneNode): string {
  if (node.type === 'TEXT') return (node as TextNode).characters.trim();
  const name = node.name.trim();
  if (name) return name;
  const textChild = (node as any).findAll?.((n: SceneNode) => n.type === 'TEXT') ?? [];
  const first = textChild[0] as TextNode | undefined;
  return first ? first.characters.trim() : name || '(без подписи)';
}

function buildDesignJson(
  selection: readonly SceneNode[],
  featureName: string | null,
  scenarioGoal: string | null,
  keyMetrics: string | null
): DesignJson {
  const businessGoals: string[] = scenarioGoal ? [scenarioGoal] : [];
  const successMetrics: string[] = keyMetrics ? keyMetrics.split(/[,;]/).map(s => s.trim()).filter(Boolean) : [];
  const userPains: string[] = [];

  const feature: DesignJsonFeature = {
    name: featureName ?? 'не указано',
    scenario: scenarioGoal ?? '',
    business_goals: businessGoals,
    success_metrics: successMetrics,
    user_pains: userPains,
  };

  const frameIds = new Set<string>();
  const framesMap = new Map<string, DesignJsonFrame>();

  function collectFrame(node: SceneNode, depth: number): void {
    if (depth > MAX_FRAME_DEPTH || framesMap.size >= MAX_RELATED_FRAMES) return;
    const id = node.id;
    if (frameIds.has(id)) return;
    const isFrame = node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE';
    if (!isFrame) return;
    frameIds.add(id);

    const texts: DesignJsonText[] = [];
    const actions: DesignJsonAction[] = [];

    function walk(n: SceneNode, parentName: string) {
      if (n.type === 'TEXT') {
        const tn = n as TextNode;
        const content = tn.characters.trim();
        if (content.length > 0) {
          texts.push({
            id: tn.id,
            content: content.length > 200 ? content.slice(0, 200) + '…' : content,
            semantic_role: inferTextRole(tn, parentName),
            font_size: typeof tn.fontSize === 'number' ? tn.fontSize : null,
          });
        }
      }
      const nameLower = n.name.toLowerCase();
      const isButton = nameLower.includes('button') || nameLower.includes('btn') || nameLower.includes('кнопк') || nameLower.includes('cta');
      const isInput = nameLower.includes('input') || nameLower.includes('field') || nameLower.includes('поле') || nameLower.includes('ввод');
      const isClickable = isButton || isInput || ('reactions' in n && Array.isArray((n as any).reactions) && (n as any).reactions.length > 0);
      if (isClickable || ('reactions' in n && (n as any).reactions?.length > 0)) {
        const targetId = getTargetFrameId(n);
        const label = getTextLabel(n);
        const hasOnlyIcon = nameLower.includes('icon') && !(n as any).findAll?.((c: SceneNode) => c.type === 'TEXT')?.length;
        actions.push({
          id: n.id,
          label,
          kind: inferActionKind(n.name, !!hasOnlyIcon),
          target_frame_id: targetId,
        });
        if (targetId) {
          const targetNode = figma.getNodeById(targetId);
          if (targetNode && 'id' in targetNode) collectFrame(targetNode as SceneNode, depth + 1);
        }
      }
      if ('children' in n) {
        for (const child of n.children as readonly SceneNode[]) walk(child, n.name);
      }
    }

    walk(node, '');
    const role = inferFrameRole(node.name);
    framesMap.set(id, {
      id,
      name: node.name,
      role,
      texts,
      actions,
    });
  }

  for (const node of selection) {
    collectFrame(node, 0);
  }

  const startId = selection.length > 0 && 'id' in selection[0] ? selection[0].id : '';
  if (startId && !framesMap.has(startId)) {
    const root = selection[0];
    const texts: DesignJsonText[] = [];
    const actions: DesignJsonAction[] = [];
    function walkRoot(n: SceneNode, parentName: string) {
      if (n.type === 'TEXT') {
        const tn = n as TextNode;
        const c = tn.characters.trim();
        if (c.length > 0) texts.push({ id: tn.id, content: c.length > 200 ? c.slice(0, 200) + '…' : c, semantic_role: inferTextRole(tn, parentName), font_size: typeof tn.fontSize === 'number' ? tn.fontSize : null });
      }
      const nameLower = n.name.toLowerCase();
      const isButton = nameLower.includes('button') || nameLower.includes('btn') || nameLower.includes('кнопк') || nameLower.includes('cta');
      const isInput = nameLower.includes('input') || nameLower.includes('field') || nameLower.includes('поле');
      if (isButton || isInput || ('reactions' in n && (n as any).reactions?.length > 0)) {
        actions.push({ id: n.id, label: getTextLabel(n), kind: inferActionKind(n.name, false), target_frame_id: getTargetFrameId(n) });
      }
      if ('children' in n) for (const ch of n.children as readonly SceneNode[]) walkRoot(ch, n.name);
    }
    walkRoot(root, '');
    framesMap.set(startId, { id: startId, name: root.name, role: inferFrameRole(root.name), texts, actions });
  }

  const frames = Array.from(framesMap.values());

  const dsReport = runLocalDesignSystemCheck(selection);
  const accessibility_flags: DesignJsonFlowAccessibility = {};
  if (dsReport.issues.some((i) => i.type === 'SMALL_TOUCH_TARGET')) accessibility_flags.small_touch_targets = true;
  if (dsReport.issues.some((i) => i.type === 'SMALL_TEXT')) accessibility_flags.small_text = true;
  if (dsReport.issues.some((i) => i.type === 'NON_SYSTEM_TEXT_STYLE')) accessibility_flags.inconsistent_typography = true;
  if (dsReport.issues.some((i) => i.type === 'NON_SYSTEM_COLOR')) accessibility_flags.non_system_colors = true;
  const otherTypes = dsReport.issues
    .filter((i) => ['NON_SYSTEM_COMPONENT', 'MISSING_LABEL'].indexOf(i.type) !== -1)
    .map((i) => i.type);
  if (otherTypes.length > 0) accessibility_flags.other = [...new Set(otherTypes)];

  return {
    feature,
    flow: { start_frame_id: startId, frames, accessibility_flags },
  };
}

// --- Deep design metadata extraction ---

type DesignMeta = {
  frames: number;
  texts: number;
  buttons: number;
  inputs: number;
  images: number;
  icons: number;
  totalElements: number;
  smallTextCount: number;
  fontSizes: number[];
  uniqueFontSizes: number;
  fontFamilies: string[];
  textContents: string[];
  elementNames: string[];
  buttonNames: string[];
  inputNames: string[];
  smallTouchTargets: string[];
  colorsUsed: number;
  maxNestingDepth: number;
  hasLongTexts: boolean;
  longTextNames: string[];
  duplicateTexts: string[];
  rootWidth: number;
  rootHeight: number;
};

function collectDesignMeta(selection: readonly SceneNode[]): DesignMeta {
  const meta: DesignMeta = {
    frames: 0, texts: 0, buttons: 0, inputs: 0, images: 0, icons: 0,
    totalElements: 0, smallTextCount: 0,
    fontSizes: [], uniqueFontSizes: 0, fontFamilies: [],
    textContents: [], elementNames: [], buttonNames: [], inputNames: [],
    smallTouchTargets: [], colorsUsed: 0, maxNestingDepth: 0,
    hasLongTexts: false, longTextNames: [], duplicateTexts: [],
    rootWidth: 0, rootHeight: 0,
  };

  const colorSet = new Set<string>();
  const fontFamilySet = new Set<string>();
  const fontSizeSet = new Set<number>();
  const textMap = new Map<string, number>();

  function walk(node: SceneNode, depth: number) {
    meta.totalElements++;
    meta.maxNestingDepth = Math.max(meta.maxNestingDepth, depth);

    const nameLower = node.name.toLowerCase();
    meta.elementNames.push(node.name);

    const isButton = nameLower.includes('button') || nameLower.includes('btn') || nameLower.includes('кнопк') || nameLower.includes('cta');
    const isInput = nameLower.includes('input') || nameLower.includes('field') || nameLower.includes('поле') || nameLower.includes('ввод') || nameLower.includes('search') || nameLower.includes('поиск');
    const isIcon = nameLower.includes('icon') || nameLower.includes('иконк') || nameLower.includes('ico') || (nameLower.includes('img') && 'width' in node && (node as any).width < 40);
    const isImage = node.type === 'RECTANGLE' && (nameLower.includes('image') || nameLower.includes('photo') || nameLower.includes('фото') || nameLower.includes('картинк') || nameLower.includes('img') || nameLower.includes('avatar'));

    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') meta.frames++;

    if (node.type === 'TEXT') {
      meta.texts++;
      const tn = node as TextNode;
      const fontSize = tn.fontSize;
      if (typeof fontSize === 'number') {
        meta.fontSizes.push(fontSize);
        fontSizeSet.add(fontSize);
        if (fontSize < 12) meta.smallTextCount++;
      }
      const ff = tn.fontName;
      if (ff && typeof ff === 'object' && 'family' in ff) fontFamilySet.add(ff.family);

      const content = tn.characters.trim();
      if (content.length > 0) {
        meta.textContents.push(content.length > 60 ? content.substring(0, 60) + '…' : content);
        const count = (textMap.get(content) ?? 0) + 1;
        textMap.set(content, count);
      }
      if (content.length > 200) {
        meta.hasLongTexts = true;
        meta.longTextNames.push(node.name);
      }
    }

    if (isButton || (node.type === 'INSTANCE' && isButton)) {
      meta.buttons++;
      meta.buttonNames.push(node.name);
    }
    if (isInput) {
      meta.inputs++;
      meta.inputNames.push(node.name);
    }
    if (isIcon) meta.icons++;
    if (isImage) meta.images++;

    if ((isButton || isInput) && 'width' in node && 'height' in node) {
      const w = (node as any).width as number;
      const h = (node as any).height as number;
      if (w < 44 || h < 44) {
        meta.smallTouchTargets.push(`${node.name} (${Math.round(w)}x${Math.round(h)})`);
      }
    }

    if ('fills' in node) {
      const fills = (node as any).fills;
      if (Array.isArray(fills)) {
        for (const f of fills) {
          if (f.type === 'SOLID' && f.color) {
            const c = f.color;
            colorSet.add(`${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`);
          }
        }
      }
    }

    if ('children' in node) {
      for (const child of node.children as readonly SceneNode[]) walk(child, depth + 1);
    }
  }

  for (const node of selection) {
    if ('width' in node && 'height' in node) {
      meta.rootWidth = Math.max(meta.rootWidth, (node as any).width as number);
      meta.rootHeight = Math.max(meta.rootHeight, (node as any).height as number);
    }
    walk(node, 0);
  }

  meta.uniqueFontSizes = fontSizeSet.size;
  meta.fontFamilies = Array.from(fontFamilySet);
  meta.colorsUsed = colorSet.size;

  for (const [text, count] of textMap.entries()) {
    if (count > 1 && text.length > 3) meta.duplicateTexts.push(text.length > 40 ? text.substring(0, 40) + '…' : text);
  }

  return meta;
}

function buildMetadataSummary(meta: DesignMeta): string {
  const lines: string[] = [];
  lines.push(`Размер: ${Math.round(meta.rootWidth)}x${Math.round(meta.rootHeight)}px, элементов: ${meta.totalElements}`);
  lines.push(`Фреймы: ${meta.frames}, тексты: ${meta.texts}, кнопки: ${meta.buttons}, поля ввода: ${meta.inputs}, иконки: ${meta.icons}, изображения: ${meta.images}`);
  lines.push(`Уникальных размеров шрифта: ${meta.uniqueFontSizes} (${meta.fontSizes.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).join(', ')}px)`);
  if (meta.fontFamilies.length > 0) lines.push(`Шрифты: ${meta.fontFamilies.join(', ')}`);
  lines.push(`Уникальных цветов: ${meta.colorsUsed}`);
  lines.push(`Глубина вложенности: ${meta.maxNestingDepth}`);
  if (meta.buttonNames.length > 0) lines.push(`Кнопки: ${meta.buttonNames.slice(0, 8).join(', ')}`);
  if (meta.inputNames.length > 0) lines.push(`Поля ввода: ${meta.inputNames.slice(0, 8).join(', ')}`);
  if (meta.smallTextCount > 0) lines.push(`Текстов < 12px: ${meta.smallTextCount}`);
  if (meta.smallTouchTargets.length > 0) lines.push(`Малые зоны нажатия (< 44px): ${meta.smallTouchTargets.slice(0, 5).join(', ')}`);
  if (meta.hasLongTexts) lines.push(`Длинные тексты (>200 симв.): ${meta.longTextNames.slice(0, 3).join(', ')}`);
  if (meta.duplicateTexts.length > 0) lines.push(`Повторяющиеся тексты: ${meta.duplicateTexts.slice(0, 5).join('; ')}`);
  if (meta.textContents.length > 0) lines.push(`Примеры текстов: ${meta.textContents.slice(0, 10).join(' | ')}`);
  return lines.join('\n');
}

// --- Static audit with rich analysis ---

type CheckResult = { id: string; title: string; passed: boolean; where: string; why: string; action: string };

function runChecks(meta: DesignMeta): CheckResult[] {
  const results: CheckResult[] = [];
  function add(id: string, title: string, passed: boolean, where: string, why: string, action: string) {
    results.push({ id, title, passed, where, why, action });
  }

  add('cta', 'Явное основное действие (CTA)', meta.buttons > 0,
    'область действий', 'Без явного CTA пользователь не понимает, что делать.',
    meta.buttons === 0 ? 'Добавить кнопку основного действия с чётким текстом (глагол + результат).' : '');

  add('font-readability', 'Читаемость текста', meta.smallTextCount === 0,
    meta.smallTextCount > 0 ? `${meta.smallTextCount} текстовых блоков` : 'текстовые блоки',
    'Шрифт < 12px снижает читаемость на мобильных и для людей с ослабленным зрением.',
    meta.smallTextCount > 0 ? `Увеличить размер ${meta.smallTextCount} текст(ов) до минимум 14px.` : '');

  add('typography-hierarchy', 'Типографическая иерархия', meta.uniqueFontSizes >= 2 && meta.uniqueFontSizes <= 5,
    'все текстовые блоки',
    meta.uniqueFontSizes < 2 ? 'Один размер шрифта — нет визуальной иерархии.' : meta.uniqueFontSizes > 5 ? `${meta.uniqueFontSizes} разных размеров — хаотичная типографика.` : '',
    meta.uniqueFontSizes < 2 ? 'Использовать 3-4 размера: заголовок, подзаголовок, основной текст, подпись.' : meta.uniqueFontSizes > 5 ? `Сократить с ${meta.uniqueFontSizes} до 3-4 размеров шрифта для единообразия.` : '');

  add('color-consistency', 'Консистентность цветовой палитры', meta.colorsUsed <= 8,
    'элементы экрана',
    meta.colorsUsed > 8 ? `${meta.colorsUsed} уникальных цветов — визуальный шум, нет единой палитры.` : '',
    meta.colorsUsed > 8 ? `Сократить палитру с ${meta.colorsUsed} до 5-7 цветов: основной, акцент, фон, текст, ошибка.` : '');

  add('touch-targets', 'Зоны нажатия (touch targets)', meta.smallTouchTargets.length === 0,
    meta.smallTouchTargets.length > 0 ? meta.smallTouchTargets.slice(0, 3).join(', ') : 'интерактивные элементы',
    'Область нажатия < 44px вызывает ошибки нажатия, особенно на мобильных.',
    meta.smallTouchTargets.length > 0 ? `Увеличить ${meta.smallTouchTargets.slice(0, 3).join(', ')} до минимум 44x44px.` : '');

  add('input-presence', 'Поля ввода и формы', !(meta.inputNames.length > 0 && meta.texts < meta.inputNames.length * 2),
    meta.inputNames.length > 0 ? meta.inputNames.slice(0, 3).join(', ') : 'область форм',
    'Полям ввода не хватает подписей, подсказок или плейсхолдеров.',
    meta.inputNames.length > 0 ? `Добавить label или подсказку для каждого поля: ${meta.inputNames.slice(0, 3).join(', ')}.` : 'Добавить подписи к полям ввода.');

  add('content-overload', 'Когнитивная нагрузка', meta.totalElements <= 80 && meta.texts <= 25,
    'экран целиком',
    meta.totalElements > 80 ? `${meta.totalElements} элементов — экран перегружен.` : meta.texts > 25 ? `${meta.texts} текстовых блоков — слишком много информации.` : '',
    meta.totalElements > 80 ? `Разбить экран на шаги или скрыть второстепенное (аккордеон, «подробнее»). Сейчас ${meta.totalElements} элементов.` : meta.texts > 25 ? `Сократить количество текста (${meta.texts} блоков). Оставить только нужное для текущего действия.` : '');

  add('nesting-depth', 'Структурная сложность', meta.maxNestingDepth <= 8,
    'структура слоёв',
    meta.maxNestingDepth > 8 ? `Глубина вложенности ${meta.maxNestingDepth} — макет сложен для поддержки и адаптации.` : '',
    meta.maxNestingDepth > 8 ? `Упростить структуру: вынести вложенные элементы в отдельные компоненты. Сейчас ${meta.maxNestingDepth} уровней.` : '');

  add('long-text', 'Длинные текстовые блоки', !meta.hasLongTexts,
    meta.longTextNames.length > 0 ? meta.longTextNames.slice(0, 2).join(', ') : 'текстовые блоки',
    'Длинные тексты (>200 символов) не читают. Пользователь сканирует, не читает.',
    meta.longTextNames.length > 0 ? `Сократить текст в ${meta.longTextNames.slice(0, 2).join(', ')} или вынести подробности в раскрывающуюся секцию.` : '');

  add('duplicate-content', 'Повторяющийся контент', meta.duplicateTexts.length === 0,
    meta.duplicateTexts.length > 0 ? `«${meta.duplicateTexts[0]}» и другие` : 'текстовые блоки',
    'Повторяющиеся тексты увеличивают длину экрана без добавления ценности.',
    meta.duplicateTexts.length > 0 ? `Убрать дублирование: «${meta.duplicateTexts[0]}» повторяется. Оставить один экземпляр.` : '');

  add('font-families', 'Единообразие шрифтов', meta.fontFamilies.length <= 2,
    'все тексты',
    meta.fontFamilies.length > 2 ? `${meta.fontFamilies.length} разных шрифта (${meta.fontFamilies.join(', ')}) — нарушает визуальную целостность.` : '',
    meta.fontFamilies.length > 2 ? `Оставить максимум 2 шрифта. Сейчас: ${meta.fontFamilies.join(', ')}.` : '');

  add('icons-accessibility', 'Доступность иконок', !(meta.icons > 0 && meta.icons > meta.texts * 0.5),
    meta.icons > 0 ? `${meta.icons} иконок` : 'иконки',
    'Иконки без текстовых подписей непонятны новым пользователям и невидимы для скринридеров.',
    meta.icons > 0 ? `Добавить текстовые подписи или tooltip к ${meta.icons} иконкам. Для скринридеров добавить aria-label.` : '');

  const btnNamesLower = meta.buttonNames.map(n => n.toLowerCase());
  const vagueBtnNames = btnNamesLower.filter(n => n === 'button' || n === 'btn' || n === 'кнопка' || n.length <= 2);
  add('button-labels', 'Понятные подписи кнопок', vagueBtnNames.length === 0,
    meta.buttonNames.length > 0 ? meta.buttonNames.slice(0, 3).join(', ') : 'кнопки',
    'Кнопки с шаблонными названиями ("Button", "Btn") не передают намерение действия.',
    vagueBtnNames.length > 0 ? `Переименовать кнопки в действие: вместо "${vagueBtnNames[0]}" — глагол + результат (например, "Оформить заказ").` : '');

  add('visual-balance', 'Визуальный баланс экрана', meta.rootHeight > 0 && meta.rootHeight < 2000,
    'экран целиком',
    meta.rootHeight >= 2000 ? `Высота экрана ${Math.round(meta.rootHeight)}px — слишком длинный скролл.` : '',
    meta.rootHeight >= 2000 ? `Сократить экран (${Math.round(meta.rootHeight)}px). Разбить на шаги или перенести часть контента на другие экраны.` : '');

  return results;
}

function runStaticAudit(selection: readonly SceneNode[], featureName: string | null): AiReport {
  const meta = collectDesignMeta(selection);
  const checks = runChecks(meta);
  const failed = checks.filter(c => !c.passed);
  const passedCount = checks.filter(c => c.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);

  const top3 = failed.slice(0, 3).map(c => ({
    title: c.title,
    where: c.where,
    why: c.why,
    action: c.action,
  }));

  const quickWins = failed.slice(0, 5).map(c => c.action);

  const inclusivityTips: string[] = [];
  if (meta.smallTextCount > 0) inclusivityTips.push(`Увеличить ${meta.smallTextCount} текст(ов) до 14px+ для доступности.`);
  if (meta.smallTouchTargets.length > 0) inclusivityTips.push(`Увеличить зоны нажатия: ${meta.smallTouchTargets.slice(0, 2).join(', ')} до 44x44px.`);
  if (meta.icons > 0) inclusivityTips.push(`Добавить текстовые подписи к ${meta.icons} иконкам для скринридеров.`);
  if (meta.colorsUsed > 0) inclusivityTips.push('Проверить контраст текст/фон (WCAG AA: минимум 4.5:1). Не полагаться только на цвет.');
  if (inclusivityTips.length < 2) {
    inclusivityTips.push('Убедиться, что экран работает при увеличении шрифта на 200%.');
    inclusivityTips.push('Проверить навигацию с клавиатуры (Tab, Enter) для всех интерактивных элементов.');
  }

  const failedTitles = failed.map(c => c.title);
  let summaryShort: string;
  if (score >= 85) {
    summaryShort = failedTitles.length > 0
      ? `Экран хорошо структурирован (${meta.frames} фреймов, ${meta.buttons} кнопок). Стоит доработать: ${failedTitles.slice(0, 2).join(', ')}.`
      : `Экран ясен и сфокусирован (${meta.totalElements} элементов, ${meta.uniqueFontSizes} размера шрифта).`;
  } else if (score >= 60) {
    summaryShort = `Обнаружены проблемы (${failed.length} из ${checks.length} проверок): ${failedTitles.slice(0, 3).join(', ')}.`;
  } else {
    summaryShort = `Серьёзные проблемы (${failed.length} из ${checks.length}): ${failedTitles.slice(0, 4).join(', ')}. Экран требует существенной переработки.`;
  }

  return { summaryShort, score, top3Problems: top3, quickWins, inclusivityTips };
}

// --- Selection bounds ---

function getSelectionBounds(selection: readonly SceneNode[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasBounds = false;

  function collect(node: SceneNode) {
    if ('absoluteBoundingBox' in node && node.absoluteBoundingBox) {
      const b = node.absoluteBoundingBox;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
      hasBounds = true;
    }
    if ('children' in node) for (const c of node.children as readonly SceneNode[]) collect(c);
  }
  for (const node of selection) collect(node);
  if (!hasBounds) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// --- UX Audit report on canvas (block structure) ---

async function createUxReportOnCanvas(
  report: UxAuditReport,
  featureName: string | null,
  selection: readonly SceneNode[]
): Promise<void> {
  const bounds = getSelectionBounds(selection);
  const GAP = 12;
  const ROOT_W = 600;
  const CARD_PAD = 16;
  const CARD_RADIUS = 10;

  const fontPairs = [
    { regular: { family: 'Inter', style: 'Regular' }, bold: { family: 'Inter', style: 'Bold' } },
    { regular: { family: 'Roboto', style: 'Regular' }, bold: { family: 'Roboto', style: 'Bold' } },
    { regular: { family: 'Arial', style: 'Regular' }, bold: { family: 'Arial', style: 'Bold' } },
  ];
  let fontRegular: FontName | null = null;
  let fontBold: FontName | null = null;
  for (const pair of fontPairs) {
    try {
      await figma.loadFontAsync(pair.regular);
      await figma.loadFontAsync(pair.bold);
      fontRegular = pair.regular;
      fontBold = pair.bold;
      break;
    } catch { /* next */ }
  }
  if (!fontRegular || !fontBold) {
    figma.notify('Не удалось загрузить шрифт.');
    return;
  }

  const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } };
  const BG: SolidPaint = { type: 'SOLID', color: { r: 0.96, g: 0.96, b: 0.97 } };
  const TEXT_COLOR: SolidPaint = { type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.12 } };
  const TEXT_SEC: SolidPaint = { type: 'SOLID', color: { r: 0.42, g: 0.44, b: 0.5 } };

  const TEXT_MAX_W = ROOT_W - 40 - CARD_PAD * 2;

  function makeText(content: string, size: number, font: FontName, fill: SolidPaint): TextNode {
    const t = figma.createText();
    t.fontName = font;
    t.characters = (content || '').slice(0, 2000);
    t.fontSize = size;
    t.fills = [fill];
    t.textAutoResize = 'HEIGHT';
    t.resize(TEXT_MAX_W, Math.max(t.height, 1));
    return t;
  }

  function makeSection(title: string, borderColor?: RGB): FrameNode {
    const card = figma.createFrame();
    card.name = title;
    card.layoutMode = 'VERTICAL';
    card.primaryAxisSizingMode = 'AUTO';
    card.counterAxisSizingMode = 'AUTO';
    card.itemSpacing = 8;
    card.clipsContent = false;
    card.paddingTop = CARD_PAD;
    card.paddingBottom = CARD_PAD;
    card.paddingLeft = CARD_PAD;
    card.paddingRight = CARD_PAD;
    card.fills = [WHITE];
    card.cornerRadius = CARD_RADIUS;
    if (borderColor) {
      card.strokes = [{ type: 'SOLID', color: borderColor }];
      card.strokeWeight = 3;
      card.strokeAlign = 'INSIDE';
    }
    const titleNode = makeText(title, 13, fontBold!, TEXT_COLOR);
    card.appendChild(titleNode);
    return card;
  }

  function addLine(card: FrameNode, text: string, fontSize = 12): void {
    if (!text) return;
    const node = makeText(text, fontSize, fontRegular!, TEXT_COLOR);
    card.appendChild(node);
  }

  function addScreenBadge(card: FrameNode, screen: string): void {
    if (!screen) return;
    const node = makeText(`Экран: ${screen}`, 10, fontRegular!, TEXT_SEC);
    card.insertChild(0, node);
  }

  function parseScreenFromText(text: string): { screen: string | null; rest: string } {
    if (!text || typeof text !== 'string') return { screen: null, rest: text || '' };
    const m = text.match(/^Экран:\s*([^.—]+)[.\s—]+(.+)$/);
    if (m) return { screen: m[1].trim(), rest: m[2].trim() };
    return { screen: null, rest: text };
  }

  const root = figma.createFrame();
  root.name = 'UX Audit — ' + (featureName ?? 'отчёт');
  root.layoutMode = 'VERTICAL';
  root.primaryAxisSizingMode = 'AUTO';
  root.counterAxisSizingMode = 'FIXED';
  root.itemSpacing = GAP;
  root.paddingTop = 20;
  root.paddingBottom = 20;
  root.paddingLeft = 20;
  root.paddingRight = 20;
  root.fills = [BG];
  root.cornerRadius = 16;
  root.clipsContent = false;

  const score = report.score ?? 0;
  const header = makeText(
    `UX Audit — ${featureName ?? 'отчёт'} · ${score}/100`,
    18,
    fontBold!,
    TEXT_COLOR
  );
  root.appendChild(header);

  if (report.summaryShort) {
    const sumCard = makeSection('Краткая оценка');
    addLine(sumCard, report.summaryShort, 13);
    root.appendChild(sumCard);
  }

  if (report.cognitiveWalkthrough && report.cognitiveWalkthrough.length > 0) {
    const sect = makeSection('Cognitive Walkthrough');
    for (const c of report.cognitiveWalkthrough) {
      const clarity = (c.clarity || '').toLowerCase();
      const borderColor = clarity.includes('drop') ? { r: 0.86, g: 0.21, b: 0.27 } : clarity.includes('friction') ? { r: 0.96, g: 0.6, b: 0.1 } : { r: 0.1, g: 0.65, b: 0.4 };
      const card = makeSection(`${c.step || 'Шаг'} — ${c.clarity || ''}`, borderColor);
      if (c.screen) addScreenBadge(card, c.screen);
      if (c.userQuestion) addLine(card, `Вопрос: ${c.userQuestion}`);
      if (c.note) addLine(card, c.note);
      sect.appendChild(card);
    }
    root.appendChild(sect);
  }

  if (report.multiRoleFindings && report.multiRoleFindings.length > 0) {
    const sect = makeSection('Multi-Role Analysis');
    for (const m of report.multiRoleFindings) {
      const card = makeSection(`${m.role || ''}: ${m.screen || ''} → ${m.element || ''}`);
      if (m.screen) addScreenBadge(card, m.screen);
      if (m.finding) addLine(card, m.finding);
      if (m.suggestion) addLine(card, `→ ${m.suggestion}`);
      sect.appendChild(card);
    }
    root.appendChild(sect);
  }

  if (report.nielsenAudit && report.nielsenAudit.length > 0) {
    const sect = makeSection('Nielsen Heuristics');
    for (const n of report.nielsenAudit) {
      const card = makeSection(`${n.heuristic || ''} (${n.score ?? '—'}/2): ${n.element || ''}`);
      if (n.screen) addScreenBadge(card, n.screen);
      if (n.note) addLine(card, n.note);
      sect.appendChild(card);
    }
    root.appendChild(sect);
  }

  if (report.usabilityHypotheses && report.usabilityHypotheses.length > 0) {
    const sect = makeSection('Usability Hypotheses (ICE)');
    for (const u of report.usabilityHypotheses) {
      const card = makeSection(`ICE ${u.iceScore != null ? u.iceScore.toFixed(1) : ''} — ${u.affectedMetric || ''}`);
      if (u.screen) addScreenBadge(card, u.screen);
      if (u.hypothesis) addLine(card, u.hypothesis);
      sect.appendChild(card);
    }
    root.appendChild(sect);
  }

  if (report.quickWins && report.quickWins.length > 0) {
    const sect = makeSection('Быстрые победы');
    for (const q of report.quickWins) {
      const parsed = parseScreenFromText(q);
      if (parsed.screen) {
        const card = makeSection(`→ ${parsed.rest}`);
        addScreenBadge(card, parsed.screen);
        sect.appendChild(card);
      } else {
        addLine(sect, `→ ${q}`);
      }
    }
    root.appendChild(sect);
  }

  if (report.inclusivityTips && report.inclusivityTips.length > 0) {
    const sect = makeSection('Доступность');
    for (const t of report.inclusivityTips) {
      const parsed = parseScreenFromText(t);
      if (parsed.screen) {
        const card = makeSection(`• ${parsed.rest}`);
        addScreenBadge(card, parsed.screen);
        sect.appendChild(card);
      } else {
        addLine(sect, `• ${t}`);
      }
    }
    root.appendChild(sect);
  }

  root.resize(ROOT_W, root.height);

  if (bounds) {
    root.x = bounds.x;
    root.y = bounds.y + bounds.height + 32;
  } else {
    root.x = 24;
    root.y = 24;
  }

  figma.currentPage.appendChild(root);
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  figma.notify('Отчёт создан на канве.');
}

// --- Canvas report (legacy old format) ---

async function createReportOnCanvas(
  selection: readonly SceneNode[],
  report: AiReport,
  featureName: string | null,
  source: 'ai' | 'local',
  provider?: 'gemini' | 'perplexity' | 'none'
): Promise<void> {
  const bounds = getSelectionBounds(selection);
  const GAP = 12;
  const CARD_W = 480;
  const CARD_PAD = 20;
  const CARD_RADIUS = 12;

  const fontPairs = [
    { regular: { family: 'Inter', style: 'Regular' }, bold: { family: 'Inter', style: 'Bold' } },
    { regular: { family: 'Roboto', style: 'Regular' }, bold: { family: 'Roboto', style: 'Bold' } },
    { regular: { family: 'Arial', style: 'Regular' }, bold: { family: 'Arial', style: 'Bold' } },
  ];
  let fontRegular: FontName | null = null;
  let fontBold: FontName | null = null;
  for (const pair of fontPairs) {
    try {
      await figma.loadFontAsync(pair.regular);
      await figma.loadFontAsync(pair.bold);
      fontRegular = pair.regular;
      fontBold = pair.bold;
      break;
    } catch { /* next */ }
  }
  if (!fontRegular || !fontBold) {
    figma.notify('Не удалось загрузить шрифт. Отчёт в окне плагина.');
    return;
  }

  const WHITE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 } };
  const BG: SolidPaint = { type: 'SOLID', color: { r: 0.96, g: 0.96, b: 0.97 } };
  const TEXT_COLOR: SolidPaint = { type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.12 } };
  const TEXT_SEC: SolidPaint = { type: 'SOLID', color: { r: 0.42, g: 0.44, b: 0.5 } };
  const ACCENT: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0.4, b: 1 } };
  const RED: SolidPaint = { type: 'SOLID', color: { r: 0.86, g: 0.21, b: 0.27 } };

  const TEXT_MAX_W = CARD_W - CARD_PAD * 2;

  function makeText(content: string, size: number, font: FontName, fill: SolidPaint): TextNode {
    const t = figma.createText();
    t.fontName = font;
    t.characters = content;
    t.fontSize = size;
    t.fills = [fill];
    t.textAutoResize = 'HEIGHT';           // Hug contents по высоте
    t.resize(TEXT_MAX_W, Math.max(t.height, 1));  // ширина; высота — текущая (auto)
    return t;
  }

  function makeCard(title: string, bodyLines: string[]): FrameNode {
    const card = figma.createFrame();
    card.name = title;
    card.layoutMode = 'VERTICAL';
    card.primaryAxisSizingMode = 'AUTO';  // Hug contents по высоте
    card.counterAxisSizingMode = 'FIXED';
    card.itemSpacing = 8;
    card.clipsContent = false;
    card.paddingTop = CARD_PAD;
    card.paddingBottom = CARD_PAD;
    card.paddingLeft = CARD_PAD;
    card.paddingRight = CARD_PAD;
    card.fills = [WHITE];
    card.cornerRadius = CARD_RADIUS;

    const titleNode = makeText(title, 14, fontBold!, TEXT_COLOR);
    card.appendChild(titleNode);

    for (const line of bodyLines) {
      if (line.length === 0) continue;
      const node = makeText(line, 13, fontRegular!, TEXT_COLOR);
      card.appendChild(node);
    }
    card.resize(CARD_W, card.height);  // ширина фиксирована, высота — Hug contents
    return card;
  }

  // --- Build sections ---
  const sections: Array<{ title: string; lines: string[] }> = [];

  const providerName = provider === 'perplexity' ? 'Perplexity Sonar' : provider === 'gemini' ? 'Gemini AI' : 'Локальный';
  sections.push({
    title: `Оценка: ${report.score}/100`,
    lines: [source === 'ai' ? `Анализ: ${providerName}` : 'Локальный чек-лист'],
  });

  if (report.featureOverview) sections.push({ title: '1. Обзор флоу и контекста', lines: [report.featureOverview] });
  if (report.flowEvaluation) sections.push({ title: '2. Структура флоу', lines: [report.flowEvaluation] });
  if (report.designSystemSection) sections.push({ title: 'Дизайн‑система и паттерны', lines: [report.designSystemSection] });
  if (report.textsSection) sections.push({ title: 'Тексты и понятность', lines: [report.textsSection] });
  if (report.jtbd) sections.push({ title: '3. JTBD-оценка', lines: [report.jtbd] });
  if (report.uxSummary) sections.push({ title: '4. Краткая оценка UX', lines: [report.uxSummary] });

  if (report.researchInsights && report.researchInsights.length > 0) {
    sections.push({ title: '5. Инсайты из ресерча', lines: report.researchInsights.map(r => '• ' + r) });
  }

  const problems = report.top4Problems ?? report.top3Problems ?? [];
  if (problems.length > 0) {
    const pLines: string[] = [];
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      pLines.push(`${i + 1}. ${p.title}`);
      pLines.push(`Где: ${p.where}`);
      pLines.push(`Почему: ${p.why}`);
      if ('metric' in p && p.metric) pLines.push(`Метрика: ${p.metric}`);
      pLines.push(`→ ${p.action}`);
      if (i < problems.length - 1) pLines.push('');
    }
    sections.push({ title: '6. Топ проблем по UX', lines: pLines });
  }

  if (report.quickWins && report.quickWins.length > 0) {
    sections.push({ title: '7. Быстрые победы', lines: report.quickWins.map(q => '→ ' + q) });
  }

  const incl = report.inclusivity ?? report.inclusivityTips ?? [];
  if (incl.length > 0) {
    sections.push({ title: '8. Доступность', lines: incl.map(t => '• ' + t) });
  }

  if (report.targetUXState) sections.push({ title: '9. Целевой UX', lines: [report.targetUXState] });

  if (report.summaryShort && !report.featureOverview) {
    sections.push({ title: 'Краткая оценка', lines: [report.summaryShort] });
  }

  // --- Root frame ---
  const root = figma.createFrame();
  root.name = 'UX Audit — ' + (featureName ?? 'отчёт');
  root.layoutMode = 'VERTICAL';
  root.primaryAxisSizingMode = 'AUTO';  // Hug contents по высоте
  root.counterAxisSizingMode = 'FIXED';
  root.itemSpacing = GAP;
  root.paddingTop = 20;
  root.paddingBottom = 20;
  root.paddingLeft = 20;
  root.paddingRight = 20;
  root.fills = [BG];
  root.cornerRadius = 16;
  root.clipsContent = false;

  const headerText = makeText(
    featureName ? `UX Audit — ${featureName}` : 'UX Audit',
    18, fontBold!, TEXT_COLOR
  );
  root.appendChild(headerText);

  for (const section of sections) {
    const card = makeCard(section.title, section.lines);
    root.appendChild(card);
  }

  // Ширина фиксирована, высота — Hug contents (вычисляется после добавления детей)
  root.resize(CARD_W + 40, root.height);

  // --- Position ---
  if (bounds) {
    root.x = bounds.x;
    root.y = bounds.y + bounds.height + 32;
  } else {
    root.x = 24;
    root.y = 24;
  }

  figma.currentPage.appendChild(root);
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  figma.notify(source === 'ai' ? 'AI-отчёт создан на канве.' : 'Локальный отчёт создан на канве.');
}

// --- Оформить файл: структура + Cover + Метаданные ---

const STRUCTURE_PAGES = [
  'МБ',
  'В работе',
  '---',
  'ИБ',
  'В работе',
  '---',
  'Метаданные',
  'Cover',
];

const METADATA_PAGE_NAME = 'Метаданные';
const COVER_PAGE_NAME = 'Cover';

const FALLBACK_METADATA_FRAMES = [
  'Feature / сценарий',
  'Бизнес-цели',
  'Метрики успеха',
  'Пользовательские боли',
  'Референсы',
];

async function handleFormatFile(payload?: FormatFileMessage['payload']): Promise<void> {
  try {
    const componentKeys = payload?.componentKeys ?? [];
    const FRAME_W = 360;
    const FRAME_H = 200;
    const GAP = 16;

    let hasStructure = false;
    for (const p of figma.root.children) {
      if (p.type === 'PAGE' && p.name === 'МБ') {
        hasStructure = true;
        break;
      }
    }

    if (!hasStructure) {
      for (const name of STRUCTURE_PAGES) {
        if (name === '---') {
          figma.createPageDivider('---');
        } else {
          const page = figma.createPage();
          page.name = name;
        }
      }
      figma.notify('Создана структура файла');
    }

    let coverPage: PageNode | null = null;
    let metadataPage: PageNode | null = null;
    for (const p of figma.root.children) {
      if (p.type === 'PAGE') {
        if (p.name === COVER_PAGE_NAME) coverPage = p;
        if (p.name === METADATA_PAGE_NAME) metadataPage = p;
      }
    }
    if (!coverPage) {
      coverPage = figma.createPage();
      coverPage.name = COVER_PAGE_NAME;
    }
    if (!metadataPage) {
      metadataPage = figma.createPage();
      metadataPage.name = METADATA_PAGE_NAME;
    }

    if (componentKeys.length > 0) {
      const coverKey = componentKeys[0];
      const metadataKeys = componentKeys.slice(1);

      if (coverKey) {
        try {
          const component = await figma.importComponentByKeyAsync(coverKey);
          const instance = component.createInstance();
          instance.x = 0;
          instance.y = 0;
          coverPage.appendChild(instance);
        } catch (e) {
          const msg = String(e);
          if (msg.includes('library') || msg.includes('Library') || msg.includes('not found')) {
            figma.notify('Подключите библиотеку Tools к файлу');
          } else {
            figma.notify('Не удалось добавить Cover: ' + msg.slice(0, 50));
          }
        }
      }

      let y = 0;
      let imported = 0;
      for (const key of metadataKeys) {
        try {
          const component = await figma.importComponentByKeyAsync(key);
          const instance = component.createInstance();
          instance.x = 0;
          instance.y = y;
          metadataPage.appendChild(instance);
          y += (instance.height || FRAME_H) + GAP;
          imported++;
        } catch (e) {
          const msg = String(e);
          if (msg.includes('library') || msg.includes('Library') || msg.includes('not found')) {
            figma.notify('Подключите библиотеку Tools к файлу');
          } else {
            figma.notify('Не удалось импортировать компонент: ' + msg.slice(0, 50));
          }
        }
      }

      if (imported === 0 && metadataKeys.length > 0) {
        figma.ui.postMessage({ type: 'add-metadata-fallback', reason: 'library' });
        for (const name of FALLBACK_METADATA_FRAMES) {
          const frame = figma.createFrame();
          frame.name = name;
          frame.resize(FRAME_W, FRAME_H);
          frame.x = 0;
          frame.y = y;
          frame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.99 } }];
          metadataPage.appendChild(frame);
          y += FRAME_H + GAP;
        }
      }
    } else {
      figma.ui.postMessage({ type: 'add-metadata-fallback', reason: 'proxy' });
      let y = 0;
      for (const name of FALLBACK_METADATA_FRAMES) {
        const frame = figma.createFrame();
        frame.name = name;
        frame.resize(FRAME_W, FRAME_H);
        frame.x = 0;
        frame.y = y;
        frame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.99 } }];
        metadataPage.appendChild(frame);
        y += FRAME_H + GAP;
      }
    }

    figma.currentPage = coverPage;
    figma.notify('Файл оформлен: Cover и Метаданные');
    figma.ui.postMessage({ type: 'stub-done', message: 'Файл оформлен' });
  } catch (err) {
    figma.notify('Ошибка: ' + String(err));
    figma.ui.postMessage({ type: 'error', message: String(err) });
  }
}

// --- Main message handler ---

figma.ui.onmessage = async (msg: IncomingMessage) => {
  try {
    if (msg.type === 'close') {
      figma.closePlugin();
      return;
    }

    if (msg.type === 'format-file') {
      await handleFormatFile(msg.payload);
      return;
    }

    if (msg.type === 'check-ux') {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.notify('Выделите фрейм или флоу для UX-аудита');
        figma.ui.postMessage({ type: 'stub-done', message: 'Выделите фрейм' });
        return;
      }
      const featureName = selection.length > 0 && 'name' in selection[0] ? selection[0].name : null;
      const designJson = buildDesignJson(selection, featureName, null, null);
      figma.ui.postMessage({
        type: 'design-json-ready',
        payload: {
          designJson: JSON.stringify(designJson, null, 0),
          featureName: featureName ?? 'не указано',
          scenarioGoal: null,
          keyMetrics: null,
        },
      });
      return;
    }

    if (msg.type === 'put-report-on-canvas') {
      const p = msg.payload;
      if (!p || !p.report) {
        figma.notify('Нет отчёта для выноса на канву');
        return;
      }
      const selection = figma.currentPage.selection;
      await createUxReportOnCanvas(p.report, p.featureName ?? null, selection);
      return;
    }

    if (msg.type === 'check-design-system') {
      figma.notify('Скоро: Проверить дизайн-систему');
      figma.ui.postMessage({ type: 'stub-done', message: 'Скоро' });
      return;
    }
  } catch (globalErr) {
    figma.notify('Ошибка плагина: ' + String(globalErr));
    figma.ui.postMessage({ type: 'error', message: 'Внутренняя ошибка: ' + String(globalErr) });
  }
};
