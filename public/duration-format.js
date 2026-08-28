export function formatElapsedSeconds(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));

  if (seconds < 60) {
    return `${seconds} 秒`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  if (minutes < 60) {
    return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

export function formatDurationMs(value) {
  const milliseconds = Math.max(0, Number(value) || 0);

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }

  if (milliseconds < 10000) {
    return `${(milliseconds / 1000).toFixed(1)} 秒`;
  }

  return formatElapsedSeconds(milliseconds / 1000);
}
