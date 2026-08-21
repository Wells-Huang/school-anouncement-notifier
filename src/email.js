import nodemailer from "nodemailer";
import { escapeHtml } from "./text.js";

function displayCount(count) {
  return Number.isFinite(count) ? count : 0;
}

export function buildEmailSubject(dateKey, report) {
  const date = String(dateKey).replace(/-/g, "/");
  const mustRead = report.relevant.filter((item) => item.bucket === "今天必看").length;
  const participate = report.relevant.filter((item) => item.bucket === "適合女兒參加").length;
  return `【古亭國小公告摘要】${date}｜必看 ${mustRead} 則、可參加 ${participate} 則`;
}

function renderTextNotice(item) {
  return [
    `- ${item.title}`,
    `  發布日期：${item.publishedDate || "未提供"}｜更新日期：${item.updatedDate || "未提供"}`,
    `  分類：${item.category}｜優先級：${item.priority}`,
    `  適合原因：${item.reason}`,
    `  家長需要做什麼：${item.action}`,
    `  截止／重要日期：${item.deadline}`,
    `  摘要：${item.summary}`,
    `  原始連結：${item.originalUrl || "未取得"}`,
  ].join("\n");
}

function renderHtmlNotice(item) {
  return `<article style="margin:0 0 18px;padding:0 0 14px;border-bottom:1px solid #ddd">
  <h3 style="margin:0 0 6px;font-size:16px">${escapeHtml(item.title)}</h3>
  <p style="margin:4px 0;color:#555">發布日期：${escapeHtml(item.publishedDate || "未提供")}｜更新日期：${escapeHtml(item.updatedDate || "未提供")}｜分類：${escapeHtml(item.category)}｜優先級：${escapeHtml(item.priority)}</p>
  <p style="margin:4px 0"><strong>適合原因：</strong>${escapeHtml(item.reason)}</p>
  <p style="margin:4px 0"><strong>家長需要做什麼：</strong>${escapeHtml(item.action)}</p>
  <p style="margin:4px 0"><strong>截止／重要日期：</strong>${escapeHtml(item.deadline)}</p>
  <p style="margin:4px 0"><strong>摘要：</strong>${escapeHtml(item.summary)}</p>
  <p style="margin:4px 0"><a href="${escapeHtml(item.originalUrl || "#")}">查看原始公告</a></p>
</article>`;
}

export function buildEmail({ dateKey, report }) {
  const subject = buildEmailSubject(dateKey, report);
  const groups = ["今天必看", "適合女兒參加", "家長知道即可"];
  const textSections = [];
  const htmlSections = [];

  for (const group of groups) {
    const items = report.relevant.filter((item) => item.bucket === group);
    textSections.push(`【${group}】${items.length} 則`);
    textSections.push(items.length ? items.map(renderTextNotice).join("\n\n") : "（無）");
    htmlSections.push(`<h2 style="font-size:18px;margin:22px 0 10px">【${escapeHtml(group)}】${items.length} 則</h2>`);
    htmlSections.push(items.length ? items.map(renderHtmlNotice).join("\n") : "<p>（無）</p>");
  }

  const text = [
    "古亭國小最近 24 小時公告摘要",
    "",
    ...textSections,
    "",
    `最近 24 小時新增或更新：${displayCount(report.counts.recent24h)} 則；符合條件：${displayCount(report.counts.relevant)} 則。`,
  ].join("\n");
  const html = `<div style="font-family:Arial,'Microsoft JhengHei',sans-serif;line-height:1.6;color:#222">
  <p>古亭國小最近 24 小時公告摘要</p>
  ${htmlSections.join("\n")}
  <p style="color:#666">最近 24 小時新增或更新：${displayCount(report.counts.recent24h)} 則；符合條件：${displayCount(report.counts.relevant)} 則。</p>
</div>`;

  return { subject, text, html };
}

export async function sendSummaryEmail({ subject, text, html, config, env = process.env }) {
  const recipient = String(config.recipient || "").trim();
  const username = env.GMAIL_USERNAME || env.SMTP_USER;
  const password = (env.GMAIL_APP_PASSWORD || env.SMTP_PASS || "").replace(/\s/g, "");
  if (!recipient) {
    return {
      attempted: false,
      sent: false,
      provider: "Gmail SMTP",
      reason: "有相關公告但寄信失敗：未設定 GMAIL_TO（收件地址 Secret）",
    };
  }
  if (!username || !password) {
    return {
      attempted: false,
      sent: false,
      provider: "Gmail SMTP",
      reason: "有相關公告但寄信失敗：未設定 GMAIL_USERNAME/GMAIL_APP_PASSWORD（或 SMTP_USER/SMTP_PASS）",
    };
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST || "smtp.gmail.com",
    port: Number(env.SMTP_PORT || 465),
    secure: String(env.SMTP_SECURE || "true") !== "false",
    auth: { user: username, pass: password },
  });

  try {
    const info = await transporter.sendMail({
      from: env.GMAIL_FROM || username,
      to: recipient,
      subject,
      text,
      html,
    });
    return {
      attempted: true,
      sent: true,
      provider: "Gmail SMTP",
      to: recipient,
      response: info.response || "SMTP accepted",
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      provider: "Gmail SMTP",
      to: recipient,
      reason: `有相關公告但寄信失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
