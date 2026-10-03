---
title: Karpathy 最看好的，是哪一种？
theme: notebook
author: xiaoye
subtitle: Karpathy 排了四档 ↓
---

# AI 交给你的东西，
# 你怎么看得懂？
> Karpathy 排了四档，
> 一档比一档好。
^ @karpathy · 2026-10-02

## 第 1 档 · 文字
让它照**飞机维修手册**
的规矩来写：
```svg 1.6
<svg viewBox="0 0 440 240" fill="none" stroke="currentColor" stroke-width="6">
  <path d="M60,104 L370,104 C395,104 410,112 414,120 C410,128 395,136 370,136 L60,136 C48,136 40,129 40,120 C40,111 48,104 60,104 Z"/>
  <path d="M250,104 L190,24 L162,24 L196,104"/>
  <path d="M250,136 L190,216 L162,216 L196,136"/>
  <path d="M92,104 L62,58 L46,58 L60,104"/>
  <path d="M92,136 L62,182 L46,182 L60,136"/>
  <path class="accent" d="M380,113 C388,114 394,117 398,120"/>
</svg>
```
[规则] 一个词，一个意思
[规则] 操作句 ≤ 20 个词
^ ASD-STE100 · 约 900 个批准词

## 第 2 档 · 图
别写一大段，
直接画张图。
```svg 1.8
<svg viewBox="0 0 460 180" fill="none" stroke="currentColor" stroke-width="6">
  <rect x="14" y="58" width="112" height="64" rx="14"/>
  <path d="M38,82 L102,82 M38,100 L84,100"/>
  <path d="M132,90 L178,90 M166,78 L180,90 L166,102"/>
  <rect x="186" y="58" width="112" height="64" rx="14"/>
  <path d="M210,82 L274,82 M210,100 L256,100"/>
  <path d="M304,90 L350,90 M338,78 L352,90 L338,102"/>
  <circle class="accent" cx="400" cy="90" r="34"/>
  <path class="accent" d="M384,90 L396,103 L418,76"/>
</svg>
```

## 第 3 档 · 网页
提问时加一句 *in HTML*，
它就做出能互动的网页。
```svg 1.8
<svg viewBox="0 0 440 290" fill="none" stroke="currentColor" stroke-width="6">
  <rect x="16" y="16" width="408" height="258" rx="20"/>
  <path d="M16,62 L424,62"/>
  <circle cx="44" cy="39" r="7"/>
  <circle cx="68" cy="39" r="7"/>
  <circle cx="92" cy="39" r="7"/>
  <path d="M60,128 L380,128"/>
  <circle class="accent" cx="250" cy="128" r="15"/>
  <rect class="accent" x="60" y="176" width="150" height="56" rx="14"/>
  <path d="M240,188 L380,188 M240,214 L340,214"/>
</svg>
```

## 第 4 档 · ？
~~更长的文章？~~
~~更好看的网页？~~
!! 讲解视频
```svg 1.4
<svg viewBox="0 0 440 300" fill="none" stroke="currentColor" stroke-width="6">
  <rect x="150" y="12" width="140" height="276" rx="26"/>
  <path d="M200,34 L240,34"/>
  <path class="accent accent-fill" d="M198,112 L198,188 L260,150 Z"/>
  <path d="M172,250 L268,250"/>
  <path class="accent" d="M172,250 L214,250"/>
  <path class="accent" d="M110,70 L110,96 M97,83 L123,83"/>
  <path class="accent" d="M330,200 L330,222 M319,211 L341,211"/>
</svg>
```
> 他最看好的一种：
> 任何题目，现做现扔。

## 这支视频就是这么做的
= 一段脚本 → 一条命令
画面、音效、配乐，
==全部是代码算出来的==。
...
!! 0 素材 · 0 视频模型
^ github.com/xiaoye-motdore/explainer-shorts
