import * as React from 'react';
import { Box, Text } from '../../ink.js';

// Pikachu yellow color
const PIKACHU_YELLOW = '#FFD700';

// Original Pikachu ASCII art
export function Clawd(): React.ReactNode {
  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={PIKACHU_YELLOW}>　　 へ　　　　　／|</Text>
      <Text color={PIKACHU_YELLOW}>　　/＼7　　　 ∠＿/</Text>
      <Text color={PIKACHU_YELLOW}>　 /　│　　 ／　／</Text>
      <Text color={PIKACHU_YELLOW}>　│　Z ＿,＜　／　　 /`ヽ</Text>
      <Text color={PIKACHU_YELLOW}>　│　　　　　ヽ　　 /　　〉</Text>
      <Text color={PIKACHU_YELLOW}>　 Y　　　　　`　 /　　/</Text>
      <Text color={PIKACHU_YELLOW}>　    ●　　●　　〈　　/</Text>
      <Text color={PIKACHU_YELLOW}>　()　 へ　　　　|　＼〈</Text>
      <Text color={PIKACHU_YELLOW}>　　&gt; _　 ィ　 │ ／／</Text>
      <Text color={PIKACHU_YELLOW}>　 / へ　　 /　＜| ＼＼</Text>
      <Text color={PIKACHU_YELLOW}>　 ヽ_　　(_／　 │／／</Text>
      <Text color={PIKACHU_YELLOW}>　　7　　　　　　　|／</Text>
      <Text color={PIKACHU_YELLOW}>　　＞―r￣￣`―＿</Text>
    </Box>
  );
}

// For compatibility with existing code
export type ClawdPose = 'default' | 'arms-up' | 'look-left' | 'look-right';
