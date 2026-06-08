# 语音交互优化文档

**日期**: 2026-06-02
**最后更新**: 2026-06-03
**状态**: 短期优化已完成，中长期待实施

---

## 1. 当前架构概览

### 1.1 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| voice.ts | `src/services/voice.ts` | 音频录制服务，支持原生音频(cpal)、SoX、arecord |
| voiceStreamSTT.ts | `src/services/voiceStreamSTT.ts` | WebSocket 语音转文字客户端 |
| voiceKeyterms.ts | `src/services/voiceKeyterms.ts` | STT 关键词增强（项目名、分支名等） |
| voiceModeEnabled.ts | `src/voice/voiceModeEnabled.ts` | 功能开关与认证检查 |
| useVoice.ts | `src/hooks/useVoice.ts` | 核心语音录制 React Hook |
| useVoiceEnabled.ts | `src/hooks/useVoiceEnabled.ts` | 语音启用状态 Hook |
| useVoiceIntegration.tsx | `src/hooks/useVoiceIntegration.tsx` | 语音输入集成（hold-to-talk） |
| voice.tsx (context) | `src/context/voice.tsx` | 语音状态 Context Provider |
| voice.ts (command) | `src/commands/voice/voice.ts` | /voice 命令实现 |

### 1.2 数据流

```
用户按键 → useVoiceKeybindingHandler → useVoice.handleKeyEvent
    → startRecordingSession → voice.startRecording (音频采集)
    → voiceStreamSTT.connectVoiceStream (WebSocket)
    → onTranscript 回调 → 累积转录文本
    → 释放按键 → finishRecording → finalize → 注入输入框
```

### 1.3 支持的音频后端

1. **原生音频 (cpal)**: macOS/Linux/Windows，首选方案
2. **arecord (ALSA)**: Linux 回退方案
3. **SoX rec**: 跨平台回退方案

---

## 2. 已识别的问题

### 2.1 高优先级问题

#### P0: 重复代码 - 检查函数缺失

**位置**: `voice.ts:218-255` vs `voice.ts:287-356`

`checkVoiceDependencies()` 和 `checkRecordingAvailability()` 存在大量重复逻辑：
- 都调用 `loadAudioNapi()` 检查原生模块
- 都检查 Windows 平台限制
- 都检查 Linux arecord 可用性
- 都检查 SoX 依赖

**问题**: 如果修改一个检查逻辑，容易遗漏另一个。

**建议**: 提取共享的 `checkAudioBackendAvailability()` 函数。

#### P1: 音频缓冲区内存管理

**位置**: `useVoice.ts:246-247`

```typescript
const fullAudioRef = useRef<Buffer[]>([])
```

注释说明最大约 2MB（32KB/s × 60s），但没有硬性限制。在 focus 模式下已禁用（第 699 行），但 hold-to-talk 模式下仍可能积累。

**风险**: 长时间录制可能导致内存压力。

**建议**: 添加 `MAX_AUDIO_BUFFER_BYTES` 常量，在 `onData` 回调中检查并截断。

#### P2: WebSocket 重连竞态条件

**位置**: `useVoice.ts:769-891`

`attemptConnect` 内部的重试逻辑（第 866-891 行）使用 `setTimeout(250ms)` 进行重连，但：
- 重试期间音频继续缓冲到 `audioBuffer`
- 如果用户在重试期间释放按键，`finishRecording` 可能与重连冲突
- `attemptGenRef` 用于防止过期回调，但逻辑复杂

**建议**: 简化重试状态机，考虑使用 AbortController 模式。

### 2.2 中优先级问题

#### P3: 语言规范化硬编码

**位置**: `useVoice.ts:42-114`

`LANGUAGE_NAME_TO_CODE` 和 `SUPPORTED_LANGUAGE_CODES` 是硬编码的。如果服务端支持新语言，需要客户端更新。

**当前支持**: 18 种语言（en, es, fr, ja, de, pt, it, ko, hi, id, ru, pl, tr, nl, uk, el, cs, da, sv, no）

**建议**: 
1. 考虑从 GrowthBook 配置动态获取支持列表
2. 或至少在文档中说明更新流程

#### P4: 静默丢弃重放逻辑复杂

**位置**: `useVoice.ts:376-454`

静默丢弃检测和重放逻辑（~80 行）增加了 `finishRecording` 的复杂度：
- 检测条件：`no_data_timeout + hadAudioSignal + wsConnected + !focusTriggered + focusFlushedChars===0 + !silentDropRetried`
- 重放流程：关闭连接 → 等待 250ms → 重新连接 → 发送缓冲音频 → finalize

**问题**: 这是针对后端 bug（anthropics/anthropic#287008）的临时方案。

**建议**: 
1. 添加 TODO 标记，注明后端修复后可移除
2. 考虑提取为独立函数 `handleSilentDropReplay()`

#### P5: 事件监听器顺序依赖

**位置**: `useVoiceIntegration.tsx:609-619`

```typescript
// Strip defensively (listener order is not guaranteed —
// text input may have already added the char).
```

多处注释提到监听器顺序不保证，导致需要防御性清理。这是 useInput → onKeyDown 迁移的遗留问题。

**建议**: 完成 `onKeyDown-migration`（代码中有 TODO 标记）。

### 2.3 低优先级问题

#### P6: 调试日志过多

整个语音系统有大量 `logForDebugging` 调用（约 50+ 处）。生产环境中这些日志可能影响性能。

**建议**: 
1. 添加日志级别控制
2. 或在生产构建中移除详细日志

#### P7: 常量定义分散

各模块独立定义常量：
- `voice.ts`: `RECORDING_SAMPLE_RATE=16000`, `SILENCE_DURATION_SECS='2.0'`
- `voiceStreamSTT.ts`: `KEEPALIVE_INTERVAL_MS=8000`, `FINALIZE_TIMEOUTS_MS`
- `useVoice.ts`: `RELEASE_TIMEOUT_MS=200`, `FOCUS_SILENCE_TIMEOUT_MS=5000`

**建议**: 考虑集中到 `voiceConstants.ts`。

---

## 3. 功能完成度评估

### 3.1 核心功能

| 功能 | 状态 | 备注 |
|------|------|------|
| Hold-to-talk 录制 | ✅ 完成 | 支持空格键和修饰键组合 |
| Focus 模式录制 | ✅ 完成 | 终端焦点驱动 |
| 实时转录预览 | ✅ 完成 | 通过 voiceInterimTranscript |
| 多语言支持 | ✅ 完成 | 18 种语言 |
| 关键词增强 | ✅ 完成 | 项目名、分支名、最近文件 |
| 静默丢弃重放 | ✅ 完成 | 针对后端 bug 的临时方案 |
| 错误重试 | ✅ 完成 | 早期错误自动重试一次 |
| 音频可视化 | ✅ 完成 | 16 条波形条 |

### 3.2 平台支持

| 平台 | 原生音频 | SoX 回退 | arecord 回退 | 状态 |
|------|----------|----------|--------------|------|
| macOS | ✅ | ✅ | N/A | 完全支持 |
| Linux (桌面) | ✅ | ✅ | ✅ | 完全支持 |
| Linux (WSL2+WSLg) | ❌ | ✅ | ✅ | 需要 PulseAudio |
| Linux (WSL1/Win10) | ❌ | ❌ | ❌ | 不支持 |
| Windows | ✅ | N/A | N/A | 需要原生模块 |

### 3.3 认证与开关

| 检查项 | 实现位置 | 状态 |
|--------|----------|------|
| OAuth 认证 | `voiceModeEnabled.ts:32-44` | ✅ |
| GrowthBook kill-switch | `voiceModeEnabled.ts:16-23` | ✅ |
| 麦克风权限 | `voice.ts:269-285` | ✅ |
| 录音工具依赖 | `voice.ts:218-255` | ✅ |

---

## 4. 优化建议优先级

### 短期（1-2 周）- ✅ 已完成

1. **[P0] 合并重复检查逻辑** ✅
   - 提取 `checkAudioBackendAvailability()` 共享函数
   - `checkVoiceDependencies()` 和 `checkRecordingAvailability()` 已更新使用共享函数
   - 减少维护负担

2. **[P1] 添加音频缓冲区限制** ✅
   - 添加 `MAX_AUDIO_BUFFER_BYTES = 2 * 1024 * 1024` (2MB) 常量
   - 在 `onData` 回调中添加 `replayBufferBytes` 跟踪和限制
   - 超过限制时跳过缓冲（仍正常流式传输到 WebSocket）

3. **[P4] 标记临时代码** ✅
   - 为静默丢弃重放逻辑添加 `TODO(anthropics/anthropic#287008)` 标记
   - 注明后端修复后可移除

### 中期（1 个月）

4. **[P3] 动态语言列表**
   - 从 GrowthBook 获取支持的语言列表
   - 减少客户端更新频率

5. **[P5] 完成 onKeyDown 迁移**
   - 移除 useInput 桥接代码
   - 解决监听器顺序问题

### 长期（季度规划）

6. **[P2] 简化重试状态机**
   - 使用 AbortController 模式
   - 减少竞态条件风险

7. **[P6/P7] 代码清理**
   - 集中常量定义
   - 优化日志级别

---

## 5. 测试建议

### 5.1 单元测试覆盖

**当前状态**: ⚠️ 语音系统缺少专门的测试文件

代码中已为测试预留的导出：
- `voiceStreamSTT.ts`: `FINALIZE_TIMEOUTS_MS` (可配置超时)
- `voice.ts`: `_resetArecordProbeForTesting()`, `_resetAlsaCardsForTesting()`
- `useVoice.ts`: `computeLevel()` (RMS 计算)

**建议补充的测试文件**:
1. `voice.test.ts` - 音频录制服务测试
   - `checkVoiceDependencies()` 各平台分支
   - `checkRecordingAvailability()` 回退逻辑
   - `normalizeLanguageForSTT()` 边界情况

2. `voiceStreamSTT.test.ts` - WebSocket 客户端测试
   - 连接建立与断开
   - 消息解析（TranscriptText/Endpoint/Error）
   - 超时处理

3. `useVoice.test.ts` - Hook 测试
   - `computeLevel()` 精度测试
   - 状态机转换（idle → recording → processing → idle）
   - 音频缓冲区管理

### 5.2 集成测试场景

1. **Hold-to-talk 完整流程**: 按住 → 录制 → 释放 → 转录 → 注入
2. **Focus 模式**: 焦点获得 → 录制 → 焦点丢失 → 停止
3. **静默丢弃重放**: 模拟 no_data_timeout → 验证重放
4. **平台回退**: 原生不可用 → arecord → SoX
5. **错误恢复**: WebSocket 断开 → 重试 → 成功

---

## 6. 相关代码引用

### 关键函数

- `startRecordingSession()`: `useVoice.ts:633-1011`
- `finishRecording()`: `useVoice.ts:322-522`
- `connectVoiceStream()`: `voiceStreamSTT.ts:111-544`
- `checkRecordingAvailability()`: `voice.ts:287-356`
- `useVoiceKeybindingHandler()`: `useVoiceIntegration.tsx:373-668`

### 配置常量

- `RELEASE_TIMEOUT_MS = 200`: 按键释放检测超时
- `FOCUS_SILENCE_TIMEOUT_MS = 5000`: Focus 模式静默超时
- `KEEPALIVE_INTERVAL_MS = 8000`: WebSocket 心跳间隔
- `FINALIZE_TIMEOUTS_MS = { safety: 5000, noData: 1500 }`: 转录完成超时

---

## 7. 总结

### 完成度: 85%

语音交互系统功能完整，覆盖了主要使用场景和平台。短期优化（P0/P1/P4）已完成。剩余 15% 主要是：
- **测试覆盖缺失** (10%): 无专门测试文件，仅预留了测试导出
- 中长期优化（P2/P3/P5/P6/P7）

### 已完成优化 (2026-06-03)

| 优化项 | 状态 | 变更 |
|--------|------|------|
| P0: 合并重复检查逻辑 | ✅ | 提取 `checkAudioBackendAvailability()` 共享函数 |
| P1: 音频缓冲区限制 | ✅ | 添加 `MAX_AUDIO_BUFFER_BYTES` (2MB) 常量和 `replayBufferBytes` 跟踪 |
| P4: 标记临时代码 | ✅ | 添加 `TODO(anthropics/anthropic#287008)` 标记 |

### 风险评估

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|----------|
| 原生模块加载失败 | 高 | 低 | SoX/arecord 回退已实现 |
| 后端静默丢弃 | 中 | ~1% | 重放机制已实现，已添加 TODO 标记 |
| WebSocket 连接不稳定 | 中 | 中 | 重试机制已实现 |
| 内存泄漏（音频缓冲） | 低 | 低 | ✅ 已添加 2MB 硬性限制 |

### 下一步行动

1. ✅ 短期优化（P0/P1/P4）已完成
2. 补充单元测试和集成测试
3. 中期：动态语言列表 (P3)、onKeyDown 迁移 (P5)
4. 长期：简化重试状态机 (P2)、代码清理 (P6/P7)

---

*文档生成时间: 2026-06-02*
*基于代码版本: main branch (8b0905e)*
