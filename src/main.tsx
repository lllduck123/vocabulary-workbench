import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx-js-style';
import { cancelActiveTranslation, translateViaBaidu } from './baidu-translation';
import { loadTranslationCache, translationCacheKey, type TranslationCacheEntry } from './translation-cache';
import './styles.css';
import './help-tip.css';
import './csv-layout.css';

type Frequency = { term: string; count: number; first: number };
type CsvData = { name: string; headers: string[]; rows: string[][]; error?: string };
const STOPWORDS = new Set('a an and are as at be by for from has have he her his i in is it its me my of on or our she that the their them they this to was we were what when where which who will with you your 的 了 和 是 在 我 有 也 就 不 人 都 一个 这 他 她 它 们 为 之 与 而 及 或 被 对 到 从 以 于'.split(' '));

function tokenize(text: string) { return text.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]+|[一-龥]+/gu) ?? []; }
function isNumber(t: string) { return /^[\d０-９]+([.,，．]\d+)?%?$/.test(t); }
function makeFreq(tokens: string[], n: number, ignoreCase: boolean, excludeStop = false, excludeNumber = false): Frequency[] {
  const map = new Map<string, Frequency>();
  for (let i = 0; i <= tokens.length - n; i++) {
    const part = tokens.slice(i, i + n); const raw = part.join(n === 1 ? '' : ' '); const key = ignoreCase ? raw.toLocaleLowerCase() : raw;
    if (n === 1 && ((excludeStop && STOPWORDS.has(key)) || (excludeNumber && isNumber(key)))) continue;
    const old = map.get(key); if (old) old.count++; else map.set(key, { term: raw, count: 1, first: i });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.first - b.first);
}
function csvParse(buffer: ArrayBuffer): CsvData { 
  const bytes = new Uint8Array(buffer); const utf = new TextDecoder('utf-8').decode(bytes); const text = utf.includes('�') ? new TextDecoder('gb18030').decode(bytes) : utf;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((x) => x.length > 0); if (!lines.length) return { name: '', headers: [], rows: [] };
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const parse = (line: string) => { const out: string[] = []; let cell = '', quoted = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = !quoted; else if (c === delimiter && !quoted) { out.push(cell); cell = ''; } else cell += c; } out.push(cell); return out; };
  const parsed = lines.map(parse); const scanLimit = Math.min(20, Math.max(1, parsed.length - 1)); let headerIndex = 0; let bestScore = -Infinity; for (let i = 0; i < scanLimit; i++) { const row = parsed[i].map((v) => v.trim()).filter(Boolean); const next = parsed[i + 1] ?? []; const nextNext = parsed[i + 2] ?? []; const unique = new Set(row).size; const numeric = row.filter((v) => /^[\d.,%+-]+$/.test(v)).length; const score = row.length * 3 + unique * 2 + (Math.abs(next.length - parsed[i].length) <= 1 ? 4 : 0) + (Math.abs(nextNext.length - parsed[i].length) <= 1 ? 2 : 0) - numeric * 2 - (parsed[i].length === 1 ? 5 : 0) - i * 0.05; if (score > bestScore) { bestScore = score; headerIndex = i; } } const headers = parsed[headerIndex].map((h, i) => h.trim() || "未命名列" + (i + 1)); return { name: "", headers, rows: parsed.slice(headerIndex + 1) };
}
function cleanSheetName(name: string, used: Set<string>) { let base = name.replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || '未命名'; let out = base; let n = 2; while (used.has(out)) { const suffix = `_${n++}`; out = base.slice(0, 31 - suffix.length) + suffix; } used.add(out); return out; }

function App() {
  const [texts, setTexts] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem('vw-texts') ?? 'null'); if (Array.isArray(saved)) return [...saved.slice(0, 10), ...Array(Math.max(0, 10 - saved.length)).fill('')].slice(0, 10); } catch {} return [localStorage.getItem('vw-text') ?? '', ...Array(9).fill('')]; }); const [enabledTextTabs, setEnabledTextTabs] = useState<boolean[]>(() => { try { const saved = JSON.parse(localStorage.getItem('vw-enabled-text-tabs') ?? 'null'); if (Array.isArray(saved)) return [...saved.slice(0, 10), ...Array(Math.max(0, 10 - saved.length)).fill(true)].slice(0, 10).map(Boolean); } catch {} return Array(10).fill(true); }); const [activeTextTab, setActiveTextTab] = useState(0); const text = texts[activeTextTab] ?? ''; const setText = (value: string) => setTexts((previous) => previous.map((item, index) => index === activeTextTab ? value : item)); const [mainTerms, setMainTerms] = useState<string[]>(() => JSON.parse(localStorage.getItem('vw-main') ?? '[]')); const [otherTerms, setOtherTerms] = useState<string[]>(() => JSON.parse(localStorage.getItem('vw-other') ?? '[]'));
  const [limit, setLimit] = useState(10); const [statWordCount, setStatWordCount] = useState(() => { try { const saved = JSON.parse(localStorage.getItem('vw-frequency-results') ?? 'null'); return typeof saved?.statWordCount === 'number' ? saved.statWordCount : 0; } catch { return 0; } }); const [pageDraft, setPageDraft] = useState('1'); const [activeFrequency, setActiveFrequency] = useState<'one'|'two'|'custom'>('one'); const [frequencyPage, setFrequencyPage] = useState(1); const [ngram, setNgram] = useState(() => { try { const saved = JSON.parse(localStorage.getItem('vw-frequency-results') ?? 'null'); return Number.isInteger(saved?.ngram) && saved.ngram >= 3 ? saved.ngram : 3; } catch { return 3; } }); const [ignoreCase, setIgnoreCase] = useState(false); const [excludeStop, setExcludeStop] = useState(false); const [excludeNumber, setExcludeNumber] = useState(false); const [frequencyQuery, setFrequencyQuery] = useState(''); const [frequencyCaseSensitive, setFrequencyCaseSensitive] = useState(false); const [showTutorial, setShowTutorial] = useState(false); const [stats, setStats] = useState<{one: Frequency[]; two: Frequency[]; custom: Frequency[]}>(() => { try { const saved = JSON.parse(localStorage.getItem('vw-frequency-results') ?? 'null'); const savedStats = saved?.stats; if (Array.isArray(savedStats?.one) && Array.isArray(savedStats?.two) && Array.isArray(savedStats?.custom)) return savedStats; } catch {} return { one: [], two: [], custom: [] }; });
  const [files, setFiles] = useState<CsvData[]>([]); const [selectedColumns, setSelectedColumns] = useState<string[]>([]); const [translationColumns, setTranslationColumns] = useState<string[]>([]); const [translationEnabled, setTranslationEnabled] = useState(false); const [isExporting, setIsExporting] = useState(false); const [isDraggingFiles, setIsDraggingFiles] = useState(false); const [warningMessage, setWarningMessage] = useState<string | null>(null); const [warningContinue, setWarningContinue] = useState<(() => void) | null>(null); const [confirmAction, setConfirmAction] = useState<{title: string; message: string; action: () => void} | null>(null); const dragDepth = useRef(0); const [column, setColumn] = useState(''); const [sortColumn, setSortColumn] = useState(''); const [highlightRank, setHighlightRank] = useState(false); const [excludeEarlierMainMatches, setExcludeEarlierMainMatches] = useState(false); const [rootTab, setRootTab] = useState(false); const [status, setStatus] = useState(''); const [downloadReady, setDownloadReady] = useState(false); const history = useRef<string[]>([]); const historyIndex = useRef(-1);
  const [translationCache, setTranslationCache] = useState<Map<string, TranslationCacheEntry>>(() => new Map());
  useEffect(() => { void loadTranslationCache().then(setTranslationCache); }, []);
  useEffect(() => localStorage.setItem('vw-texts', JSON.stringify(texts)), [texts]); useEffect(() => localStorage.setItem('vw-enabled-text-tabs', JSON.stringify(enabledTextTabs)), [enabledTextTabs]); useEffect(() => localStorage.setItem('vw-main', JSON.stringify(mainTerms)), [mainTerms]); useEffect(() => localStorage.setItem('vw-other', JSON.stringify(otherTerms)), [otherTerms]); useEffect(() => localStorage.setItem('vw-frequency-results', JSON.stringify({ stats, statWordCount, ngram })), [stats, statWordCount, ngram]); useEffect(() => { if (!files.length) { if (column) setColumn(''); if (sortColumn) setSortColumn(''); } }, [files.length, column, sortColumn]); useEffect(() => { const hasCsv = (event: DragEvent) => { const items = Array.from(event.dataTransfer?.items ?? []); const files = Array.from(event.dataTransfer?.files ?? []); return files.some(file => /\.csv$/i.test(file.name)) || items.some(item => item.kind === 'file' && ['text/csv', 'application/vnd.ms-excel'].includes(item.type)); }; const onEnter = (event: DragEvent) => { if (!hasCsv(event)) return; event.preventDefault(); setIsDraggingFiles(true); }; const onOver = (event: DragEvent) => { if (hasCsv(event)) event.preventDefault(); }; const onDrop = (event: DragEvent) => { if (!hasCsv(event)) return; event.preventDefault(); setIsDraggingFiles(false); if (event.dataTransfer?.files.length) upload(event.dataTransfer.files); }; window.addEventListener('dragenter', onEnter); window.addEventListener('dragover', onOver); window.addEventListener('drop', onDrop); return () => { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop); }; }, []);
  const combinedText = texts.filter((value, index) => enabledTextTabs[index] && value).join("\n"); const hasRankColumn = files.some(file => file.headers.includes('搜索频率排名')); useEffect(() => { if (!hasRankColumn && highlightRank) setHighlightRank(false); }, [hasRankColumn, highlightRank]); const tokens = useMemo(() => tokenize(combinedText), [combinedText]); const counts = { chars: [...combinedText].length, words: tokens.length, sentences: combinedText ? (combinedText.match(/[。！？!?\.]+|\n+/g)?.length ?? 1) : 0 };
  const changeText = (value: string) => { if (value !== text) { history.current = history.current.slice(0, historyIndex.current + 1); history.current.push(text); historyIndex.current++; setText(value); } };
  const undo = () => { if (historyIndex.current >= 0) { setText(history.current[historyIndex.current]); historyIndex.current--; } }; const redo = () => { const next = historyIndex.current + 1; if (next < history.current.length) { setText(history.current[next]); historyIndex.current = next; } };
  const clearText = () => { if (text) setConfirmAction({ title: '清空当前页签文本', message: '确定清空当前页签的文本吗？可以使用撤销恢复。', action: () => changeText('') }); }; const clearAllTexts = () => { if (texts.some(Boolean)) setConfirmAction({ title: '清空全部页签文本', message: '确定清空全部 10 个页签的文本吗？此操作会清除所有页签内容。', action: () => setTexts(Array(10).fill('')) }); };
  const calculate = () => { setStats({ one: makeFreq(tokens, 1, ignoreCase, excludeStop, excludeNumber), two: makeFreq(tokens, 2, ignoreCase), custom: makeFreq(tokens, ngram, ignoreCase) }); setStatWordCount(tokens.length); setFrequencyPage(1); };
  const frequencyData = stats[activeFrequency]; const frequencyQueryKey = frequencyCaseSensitive ? frequencyQuery : frequencyQuery.toLocaleLowerCase(); const filteredFrequencyData = frequencyQueryKey ? frequencyData.filter(item => (frequencyCaseSensitive ? item.term : item.term.toLocaleLowerCase()).includes(frequencyQueryKey)) : frequencyData; const frequencyPages = Math.max(1, Math.ceil(filteredFrequencyData.length / limit)); const frequencyStart = (frequencyPage - 1) * limit; useEffect(() => setPageDraft(String(frequencyPage)), [frequencyPage]);
  const addTerm = (term: string, kind: 'main' | 'other') => { const setter = kind === 'main' ? setMainTerms : setOtherTerms; setter((items) => items.includes(term) ? items : [...items, term]); }; const toggleTerm = (term: string, kind: 'main' | 'other') => { const setter = kind === 'main' ? setMainTerms : setOtherTerms; setter((items) => items.includes(term) ? items.filter((item) => item !== term) : [...items, term]); };
  const [manual, setManual] = useState({ main: '', other: '' }); const addManual = (kind: 'main' | 'other') => { const v = manual[kind].trim(); if (v) { addTerm(v, kind); setManual({ ...manual, [kind]: '' }); } };
  const move = (kind: 'main' | 'other', i: number, dir: -1 | 1) => { const arr = [...(kind === 'main' ? mainTerms : otherTerms)]; const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; (kind === 'main' ? setMainTerms : setOtherTerms)(arr); };
  const upload = async (list: FileList | null) => { if (!list) return; const parsed: CsvData[] = []; for (const file of Array.from(list)) { try { const d = csvParse(await file.arrayBuffer()); parsed.push({ ...d, name: file.name }); } catch { parsed.push({ name: file.name, headers: [], rows: [], error: '解析失败' }); } } setFiles((previous) => [...previous, ...parsed]); const cols = [...new Set(parsed.flatMap(f => f.headers))]; setSelectedColumns((previous) => [...previous, ...cols.filter((col) => !previous.includes(col))]); setStatus(`已读取 ${parsed.length} 个文件，共 ${parsed.reduce((n, f) => n + f.rows.length, 0)} 行`); };
  const detectTranslationLanguage = (value: string) => { const compact = value.replace(/\s/g, ''); const chinese = (compact.match(/[\u4e00-\u9fff]/g) ?? []).length; if (chinese && chinese >= compact.length * 0.35) return 'zho_Hans'; const words = value.toLocaleLowerCase().match(/[a-zà-öø-ÿ]+/g) ?? []; const score = (terms: string[]) => words.reduce((total, word) => total + (terms.includes(word) ? 1 : 0), 0); if (/[äöüß]/i.test(value) || score(['der','die','das','und','ist','nicht','mit','für','von','auf','ein','eine']) >= 2) return 'deu_Latn'; if (/[àâçéèêëîïôûùüÿœ]/i.test(value) || score(['le','la','les','de','des','et','est','avec','pour','un','une','dans']) >= 2) return 'fra_Latn'; return 'eng_Latn'; };
  const buildWorkbook = async (force = false) => { if (isExporting) return; if (!files.length || !column) { setStatus('请先上传 CSV 并选择检索列'); return; } if (!mainTerms.length && !otherTerms.length && !force) { setWarningMessage('主词条和其他词条都为空，继续后将按当前设置生成页签。'); setWarningContinue(() => () => { void buildWorkbook(true); }); return; } const valid = files.filter(f => f.headers.includes(column)); const headers = [...new Set(valid.flatMap(f => f.headers))]; const translationTargets = translationEnabled ? translationColumns.filter(header => headers.includes(header) && selectedColumns.includes(header)) : []; const exportHeaders = headers.filter((header) => selectedColumns.includes(header) || translationTargets.includes(header) || header === sortColumn || (highlightRank && header === '搜索频率排名')); const outputHeaders = exportHeaders.flatMap(header => translationTargets.includes(header) ? [header, `${header}（翻译）`] : [header]); const allRows = valid.flatMap(f => f.rows.map(r => Object.fromEntries(headers.map(h => [h, r[f.headers.indexOf(h)] ?? ''])))); const all = sortColumn ? [...allRows].sort((a, b) => String(a[sortColumn] ?? '').localeCompare(String(b[sortColumn] ?? ''), undefined, { numeric: true, sensitivity: 'base' })) : allRows; const rootNames = new Set(valid.flatMap(f => { const fileName = f.name.trim().toLocaleLowerCase(); return [fileName, fileName.replace(/\.csv$/i, '')]; })); const isRootRow = (row: Record<string, string>) => rootNames.has(String(row[column] ?? '').trim().toLocaleLowerCase()); const rootRows = all.filter(isRootRow); const root = sortColumn ? [...rootRows].sort((a, b) => String(a[sortColumn] ?? '').localeCompare(String(b[sortColumn] ?? ''), undefined, { numeric: true, sensitivity: 'base' })) : rootRows; const filteredAll = rootTab && excludeEarlierMainMatches ? all.filter(row => !isRootRow(row)) : all; const translations = new Map<string, Map<string, string>>(); if (translationTargets.length) { setIsExporting(true); try { const values = [...new Set(all.flatMap(row => translationTargets.map(header => String(row[header] ?? '').trim())).filter(Boolean))]; const translatedValues = await translateViaBaidu(values.map(value => ({ value, sourceLanguage: detectTranslationLanguage(value) })), (completed, total) => setStatus(`正在通过百度大模型翻译 ${completed}/${total} 条数据…`)); values.forEach(value => translationTargets.forEach(header => { if (!translations.has(header)) translations.set(header, new Map()); translations.get(header)!.set(value, translatedValues.get(value) ?? value); })); } catch (error) { setStatus(`在线翻译失败：${error instanceof Error ? error.message : '请稍后重试'}`); return; } finally { setIsExporting(false); } } const wb = XLSX.utils.book_new(); const used = new Set<string>(); const add = (name: string, rows: Record<string, string>[]) => { const outputRows = rows.map(row => { const output: Record<string, string> = {}; exportHeaders.forEach(header => { const value = String(row[header] ?? ''); output[header] = value; if (translationTargets.includes(header)) output[`${header}（翻译）`] = value ? (translations.get(header)?.get(value.trim()) ?? value) : ''; }); return output; }); const ws = XLSX.utils.json_to_sheet(outputRows.length ? outputRows : [Object.fromEntries(outputHeaders.map(h => [h, '']))], { header: outputHeaders }); outputHeaders.forEach((_, columnIndex) => { const cell = ws[XLSX.utils.encode_cell({ r: 0, c: columnIndex })]; if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '17212B' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { top: { style: 'thin', color: { rgb: 'CBD8E2' } }, bottom: { style: 'thin', color: { rgb: 'CBD8E2' } }, left: { style: 'thin', color: { rgb: 'CBD8E2' } }, right: { style: 'thin', color: { rgb: 'CBD8E2' } } } }; }); ws['!rows'] = [{ hpt: 24 }]; ws['!cols'] = outputHeaders.map(header => { const lengths = [header, ...outputRows.map(row => String(row[header] ?? '') )].map(value => Array.from(value).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0)).sort((a, b) => a - b); const percentileIndex = Math.min(lengths.length - 1, Math.ceil(lengths.length * 0.9) - 1); const headerWidth = Array.from(header).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0) + 2; const dataWidth = Math.min(40, (lengths[percentileIndex] ?? 10) + 2); return { wch: Math.max(10, headerWidth, dataWidth) }; }); if (highlightRank && exportHeaders.includes('搜索频率排名')) { rows.forEach((row, rowIndex) => { const rank = Number(String(row['搜索频率排名'] ?? '').replace(/[,，\s]/g, '')); const color = rank <= 30000 && rank > 0 ? 'FDE047' : rank > 30000 && rank <= 150000 ? 'FDBA74' : null; if (color) outputHeaders.forEach((_, columnIndex) => { const cell = ws[XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })]; if (cell) cell.s = { ...(cell.s ?? {}), fill: { patternType: 'solid', fgColor: { rgb: color } }, border: { top: { style: 'thin', color: { rgb: '64748B' } }, bottom: { style: 'thin', color: { rgb: '64748B' } }, left: { style: 'thin', color: { rgb: '64748B' } }, right: { style: 'thin', color: { rgb: '64748B' } } } }; }); }); } XLSX.utils.book_append_sheet(wb, ws, cleanSheetName(name, used)); }; if (rootTab) add('根词', root); const matchesAnyTerm = (row: Record<string, string>, terms: string[]) => terms.some(term => String(row[column]).toLocaleLowerCase().includes(term.toLocaleLowerCase())); const unfiltered = filteredAll.filter(row => !matchesAnyTerm(row, mainTerms) && !matchesAnyTerm(row, otherTerms)); add('未筛选', unfiltered); const matchedByEarlierMain = new Set<Record<string, string>>(); mainTerms.forEach(term => { const termLower = term.toLocaleLowerCase(); const matches = filteredAll.filter(row => String(row[column]).toLocaleLowerCase().includes(termLower) && (!excludeEarlierMainMatches || !matchedByEarlierMain.has(row))); add(term, matches); if (excludeEarlierMainMatches) matches.forEach(row => matchedByEarlierMain.add(row)); }); const other = filteredAll.filter(row => (!excludeEarlierMainMatches || !matchesAnyTerm(row, mainTerms)) && matchesAnyTerm(row, otherTerms)); add('其他', other); add('总数据', all); XLSX.writeFile(wb, `词频汇总_${new Date().toISOString().slice(0, 10)}.xlsx`); setDownloadReady(true); setStatus(`筛选完成：${valid.length} 个文件，总数据 ${all.length} 行${translationTargets.length ? '，已添加百度大模型翻译' : ''}`); };
  return <main>{showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} />}{warningMessage && <div className="modal-backdrop" role="presentation">
<div className="confirm-dialog warning-dialog" role="dialog" aria-modal="true" aria-labelledby="warning-title">
<h3 id="warning-title">词条为空</h3>
<p>{warningMessage}</p>
<div className="confirm-actions">
<button onClick={() => { setWarningMessage(null); setWarningContinue(null); }}>返回</button>
<button className="primary" onClick={() => { const next = warningContinue; setWarningMessage(null); setWarningContinue(null); next?.(); }}>继续</button>
</div>
</div>
</div>}{confirmAction && <div className="modal-backdrop" role="presentation">
<div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
<h3 id="confirm-title">{confirmAction.title}</h3>
<p>{confirmAction.message}</p>
<div className="confirm-actions">
<button onClick={() => setConfirmAction(null)}>取消</button>
<button className="primary" onClick={() => { confirmAction.action(); setConfirmAction(null); }}>确认清空</button>
</div>
</div>
</div>}{isDraggingFiles && <div className="drag-overlay" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); dragDepth.current = 0; setIsDraggingFiles(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
<div className="drag-overlay-card">
<span>↓</span>
<strong>释放文件以导入 CSV</strong>
<small>支持一次拖入多个文件，已有文件会保留</small>
</div>
</div>}<header>
<div>
<span className="eyebrow">VOCABULARY WORKBENCH</span>
<h1>词频整理工作台</h1>
<p>把文本里的高频词，整理成可复用的词库和数据表。</p>
</div>
<div className="header-actions">
<button className="tutorial-trigger" onClick={() => setShowTutorial(true)} aria-label="打开使用教程">？ 使用教程</button>
<div className="privacy">⌁ 本地处理 · 数据不上传</div>
</div>
</header>
    <section className="stats">
<div>
<small>字符数</small>
<strong>{counts.chars.toLocaleString()}</strong>
</div>
<div>
<small>单词数</small>
<strong>{counts.words.toLocaleString()}</strong>
</div>
<div>
<small>句子数</small>
<strong>{counts.sentences.toLocaleString()}</strong>
</div>
</section>
    <div className="grid">
<section className="panel editor">
<div className="section-head">
<div>
<span className="kicker">01 / INPUT</span>
<h2>输入文本</h2>
</div>
<div className="actions">
<button onClick={undo} disabled={historyIndex.current < 0} title={historyIndex.current < 0 ? "没有可撤销的文本操作" : ""}>撤销</button>
<button className="ghost danger" onClick={clearText} disabled={!text} title={!text ? "当前没有文本可清空" : ""}>清空</button>
<button className="clear-all" onClick={clearAllTexts} disabled={!texts.some(Boolean)} title={!texts.some(Boolean) ? "当前没有任何页签内容可清空" : ""}>清空全部页签</button>
</div>
</div>
<div className="text-tabs">{texts.map((_, index) => <div className="text-tab" key={index}>
<button className={activeTextTab === index ? "active" : ""} onClick={() => setActiveTextTab(index)}>页签 {index + 1}</button>
<button type="button" className={`text-tab-toggle ${enabledTextTabs[index] ? "enabled" : "disabled"}`} title={enabledTextTabs[index] ? "点击关闭此页签统计" : "点击开启此页签统计"} onClick={() => setEnabledTextTabs(previous => previous.map((enabled, i) => i === index ? !enabled : enabled))}>{enabledTextTabs[index] ? "统计中" : "已关闭"}</button>
</div>)}</div>
<textarea value={text} onChange={e => changeText(e.target.value)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); const file = Array.from(e.dataTransfer.files).find(item => /\.txt$/i.test(item.name) || item.type === "text/plain"); if (file) file.text().then(changeText).catch(() => setStatus("读取 TXT 文件失败")); }} placeholder="粘贴或输入一大段文本，也可拖入 TXT 文件…" />
<div className="toolbar">
<button className="primary" onClick={calculate}>开始统计 <span>→</span>
</button>
<label>每页显示 <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setFrequencyPage(1); }}>
<option value={10}>10 条</option>
<option value={15}>15 条</option>
<option value={20}>20 条</option>
<option value={30}>30 条</option>
<option value={50}>50 条</option>
</select>
</label>
<label>自定义词数 <select value={ngram} onChange={e => setNgram(Number(e.target.value))}>{Array.from({length: 8}, (_, i) => <option key={i} value={i + 3}>{i + 3} 词</option>)}</select>
</label>
</div>
<div className="switches">
<label>
<input type="checkbox" checked={excludeStop} onChange={e => setExcludeStop(e.target.checked)} /> 排除语法词 <span>仅影响 1 词</span>
</label>
<label>
<input type="checkbox" checked={excludeNumber} onChange={e => setExcludeNumber(e.target.checked)} /> 排除数字词 <span>仅影响 1 词</span>
</label>
<label>
<input type="checkbox" checked={ignoreCase} onChange={e => setIgnoreCase(e.target.checked)} /> 忽略大小写</label>
</div>
</section>
      <section className="panel results">
<div className="section-head">
<div>
<span className="kicker">02 / FREQUENCY</span>
<h2>词频结果</h2>
</div>
<div className="frequency-search">
<input value={frequencyQuery} onChange={e => { setFrequencyQuery(e.target.value); setFrequencyPage(1); }} placeholder="搜索当前词频结果" aria-label="搜索当前词频结果" />
<label title="开启后，搜索会区分大小写">
<input type="checkbox" checked={frequencyCaseSensitive} onChange={e => { setFrequencyCaseSensitive(e.target.checked); setFrequencyPage(1); }} />大小写敏感</label>
</div>
</div>
<div className="freq-tabs">
<button className={activeFrequency === "one" ? "active" : ""} onClick={() => {setActiveFrequency("one"); setFrequencyPage(1)}}>1 词 <span>{stats.one.length}</span>
</button>
<button className={activeFrequency === "two" ? "active" : ""} onClick={() => {setActiveFrequency("two"); setFrequencyPage(1)}}>2 词 <span>{stats.two.length}</span>
</button>
<button className={activeFrequency === "custom" ? "active" : ""} onClick={() => {setActiveFrequency("custom"); setFrequencyPage(1)}}>{ngram} 词 <span>{stats.custom.length}</span>
</button>
</div>
<FrequencyGroup title={activeFrequency === "one" ? "1 词" : activeFrequency === "two" ? "2 词" : ngram + " 词"} data={filteredFrequencyData.slice(frequencyStart, frequencyStart + limit)} total={filteredFrequencyData.length} offset={frequencyStart} limit={limit} denominator={statWordCount} main={mainTerms} other={otherTerms} addTerm={toggleTerm} />
<div className="pagination">
<button onClick={() => setFrequencyPage(p => Math.max(1, p - 1))} disabled={frequencyPage <= 1} title={frequencyPage <= 1 ? "已经是第一页" : ""}>← 上一页</button>
<span className="page-jump">
<span>第</span>
<input className="page-input" type="number" min="1" max={frequencyPages} value={pageDraft} onChange={e => setPageDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { const page = Math.min(frequencyPages, Math.max(1, Number(pageDraft) || 1)); setFrequencyPage(page); } }} />
<span>/ {frequencyPages} 页</span>
<button onClick={() => { const page = Math.min(frequencyPages, Math.max(1, Number(pageDraft) || 1)); setFrequencyPage(page); }}>跳转</button>
</span>
<button onClick={() => setFrequencyPage(p => Math.min(frequencyPages, p + 1))} disabled={frequencyPage >= frequencyPages} title={frequencyPage >= frequencyPages ? "已经是最后一页" : ""}>下一页 →</button>
</div>
</section>
</div>
    <section className="panel terms-panel">
<div className="section-head">
<div>
<span className="kicker">03 / VOCABULARY</span>
<h2>词条栏位</h2>
</div>
<span className="muted">可拖拽或用箭头排序</span>
</div>
<div className="term-columns">
<TermColumn title="主词条" terms={mainTerms} kind="main" manual={manual.main} setManual={v => setManual({...manual, main: v})} addManual={addManual} setTerms={setMainTerms} move={move} onClear={() => setConfirmAction({ title: "清空主词条", message: "确定清空主词条栏位吗？", action: () => setMainTerms([]) })}/>
<TermColumn title="其他" terms={otherTerms} kind="other" manual={manual.other} setManual={v => setManual({...manual, other: v})} addManual={addManual} setTerms={setOtherTerms} move={move} onClear={() => setConfirmAction({ title: "清空其他词条", message: "确定清空其他词条栏位吗？", action: () => setOtherTerms([]) })}/>
</div>
</section>
    <section className="panel csv-panel">
<div className="section-head">
<div>
<span className="kicker">04 / CSV → EXCEL</span>
<h2>数据汇总</h2>
</div>
<div className="csv-actions">
<label className="upload">
<input type="file" accept=".csv,text/csv" multiple onChange={e => upload(e.target.files)} />＋ 上传多个 CSV</label>
<button className="ghost danger" onClick={() => files.length && setConfirmAction({ title: "清空已上传文件", message: "确定清空所有已上传的 CSV 文件吗？", action: () => { setFiles([]); setSelectedColumns([]); setTranslationColumns([]); setColumn(""); setSortColumn(""); setHighlightRank(false); setDownloadReady(false); setStatus(""); } })} disabled={!files.length} title={!files.length ? "当前没有已上传的 CSV 文件" : ""}>清空</button>
<button className="primary" onClick={() => { void buildWorkbook(); }} disabled={isExporting || !files.length || !column} aria-busy={isExporting} title={isExporting ? "本地翻译正在后台处理中" : !files.length ? "请先上传 CSV 文件" : !column ? "请先选择检索列" : ""}>{isExporting ? "后台处理中…" : "开始筛选并下载"} <span>{isExporting ? "⌛" : "↓"}</span>
</button>
{isExporting && <button className="ghost danger" onClick={cancelActiveTranslation}>停止翻译并下载缓存</button>}
</div>
</div>
<div className="csv-controls">
<label>所有文件使用的检索列<span className="help-tip" tabIndex={0} aria-label="检索列说明" data-tip="选择用于匹配主词条和其他词条的列。">?</span>
<select value={column} onChange={e => setColumn(e.target.value)} disabled={!files.length}>
<option value="">请选择列名</option>{[...new Set(files.flatMap(f => f.headers))].map(c => <option key={c}>{c}</option>)}</select>
</label>
<label>导出排序列<span className="help-tip" tabIndex={0} aria-label="排序列说明" data-tip="选择导出结果的排序依据；选择“不排序”则保持原顺序。">?</span>
<select value={sortColumn} onChange={e => { const value = e.target.value; setSortColumn(value); if (value) setSelectedColumns(previous => previous.includes(value) ? previous : [...previous, value]); }} disabled={!files.length}>
<option value="">不排序</option>{[...new Set(files.flatMap(f => f.headers))].map(c => <option key={c}>{c}</option>)}</select>
</label>
<div className="csv-toggles">
<label className="rank-highlight-toggle" title={hasRankColumn ? "按“搜索频率排名”列的数字为整行标色：≤30,000 黄色（最重要）；30,001–150,000 橙色（次重要）；>150,000 不标色" : "当前数据没有搜索频率排名列，开关不可用"}>
<input type="checkbox" checked={highlightRank} disabled={!hasRankColumn} onChange={e => { const checked = e.target.checked; setHighlightRank(checked); if (checked) setSelectedColumns(previous => previous.includes("搜索频率排名") ? previous : [...previous, "搜索频率排名"]); }} />排名颜色标注</label>
<label className="main-dedup-toggle" title="开启后，主词条按顺序去重；匹配过主词条的数据不会出现在“其他”页签中。若同时开启根词页签，根词数据也不会出现在其他页签中。">
<input type="checkbox" checked={excludeEarlierMainMatches} disabled={!files.length} onChange={e => setExcludeEarlierMainMatches(e.target.checked)} />词条去重</label>
<label className="root-tab-toggle" title="在导出的excel表最前面增加“根词”页签，其中包含检索列中和导入的csv文件相同的数据">
<input type="checkbox" checked={rootTab} disabled={!files.length} onChange={e => setRootTab(e.target.checked)} />根词页签</label>
<label className="translation-toggle" title="开启后显示翻译列并启用在线翻译功能">
<input type="checkbox" checked={translationEnabled} disabled={!files.length} onChange={e => setTranslationEnabled(e.target.checked)} />翻译</label>
</div>
</div>{files.length ? <>
<div className="column-picker">
<div className="column-picker-head">
<b>导出数据列</b>
<div>
<button onClick={() => setSelectedColumns([...new Set(files.flatMap(f => f.headers))])}>全选</button>
<button onClick={() => setSelectedColumns([])}>清空</button>
</div>
</div>
<div className="column-options">{[...new Set(files.flatMap(f => f.headers))].map(header => <label key={header}>
<input type="checkbox" checked={selectedColumns.includes(header)} onChange={() => setSelectedColumns(selectedColumns.includes(header) ? selectedColumns.filter(col => col !== header) : [...selectedColumns, header])} />{header}</label>)}</div>
</div>{translationEnabled && <div className="column-picker translation-picker">
<div className="column-picker-head">
<div>
<b>百度大模型翻译</b>
<small>支持多语种翻译为中文，翻译列紧跟原列</small>
</div>
<div>
<button onClick={() => setTranslationColumns(selectedColumns)}>全选</button>
<button onClick={() => setTranslationColumns([])}>清空</button>
</div>
</div>
<div className="column-options">{[...new Set(files.flatMap(f => f.headers))].filter(header => selectedColumns.includes(header)).map(header => <label key={header}>
<input type="checkbox" checked={translationColumns.includes(header)} onChange={() => setTranslationColumns(translationColumns.includes(header) ? translationColumns.filter(col => col !== header) : [...translationColumns, header])} />{header}</label>)}</div>
<TranslationCost files={files} column={column} translationColumns={translationColumns} selectedColumns={selectedColumns} cache={translationCache} detectLanguage={detectTranslationLanguage} />
</div>}</> : null}{files.length ? <div className="files">{files.map((f, i) => <div className="file" key={f.name + "-" + i}>
<span>▤</span>
<div>
<b>{f.name}</b>
<small>{f.error ?? (f.rows.length + " 行 · " + f.headers.length + " 列")}</small>
</div>
<button className="file-remove" onClick={() => setFiles(files.filter((_, index) => index !== i))} aria-label="删除文件">×</button>
</div>)}</div> : null}<div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); upload(e.dataTransfer.files); }}>拖入一个或多个 CSV 文件，或点击上方按钮选择文件</div>
<p className="status">{status || (downloadReady ? '文件已下载' : '页签顺序：根词（开启时）、未筛选、主词条、其他、总数据')}</p>
</section>
    <footer>词频整理工作台 <span>·</span> 轻量、私密、在你的浏览器里完成</footer>
</main>;
}

function TranslationCost({ files, column, translationColumns, selectedColumns, cache, detectLanguage }: { files: CsvData[]; column: string; translationColumns: string[]; selectedColumns: string[]; cache: Map<string, TranslationCacheEntry>; detectLanguage: (value: string) => string }) {
  const valid = column ? files.filter(file => file.headers.includes(column)) : files;
  const headers = [...new Set(valid.flatMap(file => file.headers))];
  const targets = translationColumns.filter(header => headers.includes(header) && selectedColumns.includes(header));
  const values = [...new Set(valid.flatMap(file => file.rows.flatMap(row => targets.map(header => String(row[file.headers.indexOf(header)] ?? '').trim()))).filter(Boolean))];
  const pending = values.filter(value => {
    const sourceLanguage = detectLanguage(value);
    return sourceLanguage !== 'zho_Hans' && !cache.has(translationCacheKey(sourceLanguage, value));
  });
  const cached = values.length - pending.length - values.filter(value => detectLanguage(value) === 'zho_Hans').length;
  const chars = pending.reduce((total, value) => total + Array.from(value).length, 0);
  return <p className="translation-note">使用限额为1百万字符/月，尽量只翻译最终版本。缓存命中：{Math.max(0, cached).toLocaleString()} 条；本次预计消耗：{chars.toLocaleString()} 字符</p>;
}

function TutorialModal({ onClose }: { onClose: () => void }) {
  return <div className="tutorial-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="tutorial-dialog" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="tutorial-heading">
<div>
<span className="eyebrow">QUICK START / 4 STEPS</span>
<h2 id="tutorial-title">三分钟学会整理词库</h2>
<p>从一段文本开始，把高频词变成可筛选、可复用的 Excel 数据。</p>
</div>
<button className="tutorial-close" onClick={onClose} aria-label="关闭教程">×</button>
</div>
      <div className="tutorial-grid">
        <TutorialStep number="01" title="粘贴文本" copy="把要分析的文章粘贴到输入框，或拖入 TXT 文件。页签 1–10 可分别放不同文本；下方显示“统计中”的页签才会合并计算。">
<div className="tutorial-visual input-visual">
<div className="mini-tabs">
<i>页签 1</i>
<i>页签 2</i>
<i>页签 3</i>
</div>
<div className="mini-lines">
<b>
</b>
<b>
</b>
<b>
</b>
<b>
</b>
</div>
<span className="mini-cursor">▍</span>
</div>
<div className="tutorial-tip">
<b>怎么选：</b>同一项目的多篇文章放在不同页签；想暂时排除某篇，就点它下面的“统计中”。</div>
</TutorialStep>
        <TutorialStep number="02" title="开始统计" copy="点击“开始统计”后，词频结果会按出现次数排序。1 词适合找关键词，2 词和自定义词数适合找固定搭配或短语。">
<div className="tutorial-visual frequency-visual">
<div className="mini-pill">1 词　24</div>
<div className="mini-result">
<strong>language</strong>
<span>12 次　32.4%</span>
</div>
<div className="mini-result">
<strong>vocabulary</strong>
<span>9 次　24.3%</span>
</div>
</div>
<div className="tutorial-tip">
<b>筛选建议：</b>英文资料可试试“排除语法词”和“忽略大小写”；数字较多时再打开“排除数字词”。</div>
</TutorialStep>
        <TutorialStep number="03" title="挑选词条" copy="在词频结果中点“主词条”或“其他”即可加入词条栏。主词条会生成独立 Excel 页签，其他词条会集中到“其他”页签。">
<div className="tutorial-visual terms-visual">
<div className="mini-column">
<em>主词条</em>
<b>language <small>↑ ↓</small>
</b>
<b>vocabulary <small>↑ ↓</small>
</b>
</div>
<div className="mini-arrow">→</div>
<div className="mini-column accent">
<em>已选 2 条</em>
<b>language</b>
<b>vocabulary</b>
</div>
</div>
<div className="tutorial-tip">
<b>整理建议：</b>把最重要的词放在主词条，并按优先级拖动排序；也可以在输入框手动补充未出现在高频榜里的词。</div>
</TutorialStep>
        <TutorialStep number="04" title="上传并导出" copy="点击“上传多个 CSV”，选择要汇总的文件。选择所有文件共有的检索列，再勾选要导出的列，最后点击“开始筛选并下载”。">
<div className="tutorial-visual export-visual">
<div className="mini-file">▤　products.csv <small>128 行 · 6 列</small>
</div>
<div className="mini-export-flow">
<span>检索列</span>
<b>→</b>
<strong>Excel ↓</strong>
</div>
</div>
<div className="tutorial-tip">
<b>导出结果：</b>页签顺序为根词（开启时）、未筛选、每个主词条页签、其他页签、总数据；可选翻译列会紧跟原列出现。</div>
</TutorialStep>
      </div>
      <div className="tutorial-faq">
<div>
<span>常见问题</span>
<h3>不知道从哪里开始？按这个顺序就好</h3>
</div>
<div className="faq-items">
<p>
<b>为什么结果是空的？</b>先确认文本已输入，再点击“开始统计”；如果搜索框有内容，也请检查是否把结果过滤掉了。</p>
<p>
<b>检索列应该选哪一列？</b>选择 CSV 中包含商品名、标题或描述等文本的列，工具会在这一列里匹配主词条和其他词条。</p>
<p>
<b>数据安全吗？</b>词频统计、词条管理和 CSV 筛选都在当前浏览器内完成；只有主动选择翻译列时，翻译内容才会调用在线翻译服务。</p>
</div>
</div>
      <div className="tutorial-note">
<span>⌁</span>
<p>小提示：所有统计和词库都会保存在当前浏览器中；原始文本和 CSV 不会上传。</p>
<button className="primary" onClick={onClose}>知道了，开始使用</button>
</div>
    </article>
  </div>;
}

function TutorialStep({ number, title, copy, children }: { number: string; title: string; copy: string; children: React.ReactNode }) {
  return <section className="tutorial-step">
<div className="step-title">
<span>{number}</span>
<h3>{title}</h3>
</div>{children}<p>{copy}</p>
</section>;
}

function FrequencyGroup({title,data,total,offset,denominator,main,other,addTerm}:{title:string;data:Frequency[];total:number;offset:number;limit:number;denominator:number;main:string[];other:string[];addTerm:(t:string,k:"main"|"other")=>void}) { return <div className="freq">
<div className="freq-title">
<b>{title}</b>
<span>{total ? (offset + 1) + "–" + (offset + data.length) + " / " + total : "暂无结果"}</span>
</div>{data.map((x,i)=>
<div className="freq-row" key={x.term + "-" + (offset+i)}>
<em>{String(offset + i + 1).padStart(2,"0")}</em>
<strong className={title === "1 词" ? "" : "phrase-term"}>{x.term}</strong>
<small className="frequency-meta">
<span className="count-value">
<b>{x.count}</b> 次</span>
<span className="meta-divider">·</span>
<span className="percent-value">
<b>{(x.count / Math.max(1, denominator)*100).toFixed(1)}</b>%</span>
</small>
<button className={"term-action main-action " + (main.includes(x.term) ? "added" : "")} onClick={() => addTerm(x.term,"main")}>{main.includes(x.term)?"✓ 主词条":"主词条"}</button>
<button className={"term-action other-action " + (other.includes(x.term) ? "added" : "")} onClick={() => addTerm(x.term,"other")}>{other.includes(x.term)?"✓ 其他":"其他"}</button>
</div>)}</div> }function TermColumn({title,terms,kind,manual,setManual,addManual,setTerms,move,onClear}:{title:string;terms:string[];kind:'main'|'other';manual:string;setManual:(v:string)=>void;addManual:(k:'main'|'other')=>void;setTerms:(v:string[])=>void;move:(k:'main'|'other',i:number,d:-1|1)=>void;onClear:()=>void}) { return <div className="term-column">
<div className="term-head">
<h3>{title}</h3>
<button className="ghost danger" onClick={onClear} disabled={!terms.length} title={!terms.length ? "当前栏位没有词条可清空" : ""}>清空</button>
</div>
<div className="manual">
<input value={manual} onChange={e=>setManual(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addManual(kind)} placeholder={`添加${title}词条…`} />
<button onClick={()=>addManual(kind)}>添加</button>
</div>
<div className="term-list">{terms.length ? terms.map((t,i)=>
<div className="term" draggable onDragStart={e=>e.dataTransfer.setData('text/plain',String(i))} onDragOver={e=>e.preventDefault()} onDrop={e=>{const from=Number(e.dataTransfer.getData('text/plain')); const a=[...terms]; const [v]=a.splice(from,1); a.splice(i,0,v); setTerms(a)}} key={t}>
<span className="handle">⠿</span>
<span>{t}</span>
<button onClick={()=>move(kind,i,-1)} aria-label="上移">↑</button>
<button onClick={()=>move(kind,i,1)} aria-label="下移">↓</button>
<button className="remove" onClick={()=>setTerms(terms.filter(x=>x!==t))}>×</button>
</div>) : <div className="empty">还没有词条<br/>
<small>从右侧词频结果一键添加</small>
</div>}</div>
<div className="term-count">共 {terms.length} 条词条</div>
</div> }

createRoot(document.getElementById('root')!).render(<React.StrictMode>
<App />
</React.StrictMode>);
