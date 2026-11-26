import { saveExportPath } from "@/api/dialog";
import { tauriApi } from "@/api/tauri";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { writingService } from "@/services/writingService";
import type { ExportFormat, ExportResult, PublishDocument, PublishTemplate } from "@/types";
import { documentToPlainText, EMPTY_DOCUMENT_TEXT } from "@/utils/tiptap";
import { createZip, type ZipEntry, zipText } from "@/utils/zip";

/** 三套排版仅差版心与分页策略，正文数据完全相同。 */
const HTML_STYLE: Record<PublishTemplate, string> = {
  web: "body{max-width:42rem;margin:0 auto;padding:2rem 1.25rem;line-height:2;font-size:17px}h1{text-align:center}h2{margin-top:3rem;font-size:1.35rem}p{margin:0 0 1.1rem;text-indent:0}",
  ebook:
    "body{max-width:40rem;margin:0 auto;padding:1.5rem;line-height:1.95;font-size:16px;font-family:serif}h2{page-break-before:always;margin-top:0}p{margin:0 0 1rem;text-indent:2em}",
  print:
    "@page{size:A4;margin:2.5cm}body{line-height:1.9;font-size:12pt;font-family:serif}h2{page-break-before:always;margin-top:0}p{margin:0;text-indent:2em}",
};

/** 把正文按空行切成段落；TipTap 的块之间本来就是空行。 */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** XML/HTML 里不能裸写这几个字符，否则书名带 & 就会让 EPUB 打不开。 */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return map[char] ?? char;
  });
}

/** 一次读齐作品信息、章节目录与每章正文，后续各格式从同一份数据生成。 */
export async function loadPublishDocument(projectId: string): Promise<PublishDocument> {
  const [project, snapshot] = await Promise.all([
    projectService.get(projectId),
    outlineService.snapshot(projectId),
  ]);
  if (!project) throw new Error("作品不存在或已删除。");

  const chapters = await Promise.all(
    snapshot.chapters.map(async (chapter) => {
      try {
        const content = await writingService.getContent(chapter.id, projectId);
        const text = documentToPlainText(content.content);
        return {
          id: chapter.id,
          title: chapter.title,
          act: chapter.act,
          summary: chapter.summary,
          text: text === EMPTY_DOCUMENT_TEXT ? "" : text,
          wordCount: chapter.wordCount,
        };
      } catch {
        // 单章读取失败（刚好被删、库被锁）不该让整本都导不出来：
        // 正文位置写明失败，作者在成品里一眼能看到缺哪一章，而不是以为这章本来就是空的。
        return {
          id: chapter.id,
          title: chapter.title,
          act: chapter.act,
          summary: chapter.summary,
          text: "（本章读取失败，请回写作台检查后重新导出）",
          wordCount: chapter.wordCount,
        };
      }
    }),
  );

  return {
    title: project.title,
    author: "",
    premise: project.premise,
    audience: project.audience,
    style: project.style,
    chapters,
  };
}

/** Markdown：最通用的稿子格式，纸质稿模板额外加分页分隔线。 */
export function renderMarkdown(doc: PublishDocument, template: PublishTemplate): string {
  const head = [`# ${doc.title}`];
  if (doc.author) head.push("", `作者：${doc.author}`);
  if (doc.premise) head.push("", `> ${doc.premise}`);
  const parts = [...head, ""];
  for (const chapter of doc.chapters) {
    parts.push(`## 第${chapter.act}幕 · ${chapter.title}`, "");
    parts.push(chapter.text.trim() || "（本章暂无正文）", "");
    if (template === "print") parts.push("---", "");
  }
  return parts.join("\n").trimEnd();
}

/** 完整 HTML 文档：模板差异只在 style 标签里，方便直接打印成 PDF。 */
export function renderHtml(doc: PublishDocument, template: PublishTemplate): string {
  const body = doc.chapters
    .map((chapter) => {
      const paras = paragraphs(chapter.text)
        .map((text) => `<p>${escapeXml(text)}</p>`)
        .join("\n");
      return `<h2>第${chapter.act}幕 · ${escapeXml(chapter.title)}</h2>\n${paras || "<p>（本章暂无正文）</p>"}`;
    })
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${escapeXml(doc.title)}</title>`,
    `<style>${HTML_STYLE[template]}</style></head><body>`,
    `<h1>${escapeXml(doc.title)}</h1>`,
    doc.author ? `<p>${escapeXml(doc.author)}</p>` : "",
    `<section>${body}</section></body></html>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** EPUB 3 的最小目录结构；mimetype 必须排第一且未压缩，createZip 满足这一点。 */
export function buildEpub(doc: PublishDocument): Uint8Array {
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
  const chapterFiles = doc.chapters.map((chapter, index) => ({
    id: `chapter-${index + 1}`,
    file: `chapter-${index + 1}.xhtml`,
    chapter,
  }));

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...chapterFiles.map(
      (item) => `<item id="${item.id}" href="${item.file}" media-type="application/xhtml+xml"/>`,
    ),
  ].join("");
  const spine = chapterFiles.map((item) => `<itemref idref="${item.id}"/>`).join("");
  const opf = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">',
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:identifier id="bookid">urn:uuid:${crypto.randomUUID()}</dc:identifier>`,
    `<dc:title>${escapeXml(doc.title)}</dc:title>`,
    `<dc:creator>${escapeXml(doc.author || "佚名")}</dc:creator>`,
    "<dc:language>zh-CN</dc:language>",
    `<meta property="dcterms:modified">${modified}</meta>`,
    "</metadata>",
    `<manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  ].join("");

  const navItems = chapterFiles
    .map(
      (item) =>
        `<li><a href="${item.file}">第${item.chapter.act}幕 · ${escapeXml(item.chapter.title)}</a></li>`,
    )
    .join("");
  const nav = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">',
    '<head><title>目录</title></head><body><nav epub:type="toc"><ol>',
    navItems,
    "</ol></nav></body></html>",
  ].join("");

  const entries: ZipEntry[] = [
    { name: "mimetype", data: zipText("application/epub+zip") },
    {
      name: "META-INF/container.xml",
      data: zipText(
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
    },
    { name: "OEBPS/content.opf", data: zipText(opf) },
    { name: "OEBPS/nav.xhtml", data: zipText(nav) },
    {
      name: "OEBPS/style.css",
      data: zipText(
        "body{font-family:serif;line-height:1.9}h2{page-break-before:always}p{text-indent:2em}",
      ),
    },
  ];
  for (const item of chapterFiles) {
    const paras = paragraphs(item.chapter.text)
      .map((text) => `<p>${escapeXml(text)}</p>`)
      .join("\n");
    entries.push({
      name: `OEBPS/${item.file}`,
      data: zipText(
        `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(item.chapter.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h2>第${item.chapter.act}幕 · ${escapeXml(item.chapter.title)}</h2>${paras}</body></html>`,
      ),
    });
  }
  return createZip(entries);
}

/** DOCX：只写正文和标题的最简 OpenXML 包，Word/WPS 都能正常打开。 */
export function buildDocx(doc: PublishDocument): Uint8Array {
  const para = (text: string): string =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const body = doc.chapters
    .flatMap((chapter) => [
      para(`第${chapter.act}幕 · ${chapter.title}`),
      ...paragraphs(chapter.text).map(para),
    ])
    .join("");
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    para(doc.title),
    body,
    "<w:sectPr/></w:body></w:document>",
  ].join("");

  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: zipText(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      data: zipText(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    { name: "word/document.xml", data: zipText(documentXml) },
  ];
  return createZip(entries);
}

/** 按导出格式生成文件字节；PDF 不在这里，交给系统打印。 */
export function renderExport(
  doc: PublishDocument,
  format: ExportFormat,
  template: PublishTemplate,
): Uint8Array {
  switch (format) {
    case "md":
      return zipText(renderMarkdown(doc, template));
    case "html":
      return zipText(renderHtml(doc, template));
    case "epub":
      return buildEpub(doc);
    case "docx":
      return buildDocx(doc);
    case "pdf":
      throw new Error("PDF 请用「打印 / 另存为 PDF」，浏览器会按当前排版输出。");
  }
}

const FILE_EXTENSION: Record<Exclude<ExportFormat, "pdf">, string> = {
  md: "md",
  html: "html",
  epub: "epub",
  docx: "docx",
};

/** 弹原生保存对话框，路径由用户选；取消时返回 null，不写任何东西。 */
export async function exportBytes(
  bytes: Uint8Array,
  format: Exclude<ExportFormat, "pdf">,
  defaultName: string,
): Promise<ExportResult | null> {
  const extension = FILE_EXTENSION[format];
  const path = await saveExportPath(defaultName, extension);
  if (!path) return null;
  return tauriApi.writeExportFile(path, Array.from(bytes));
}
