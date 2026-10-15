/** Triggers a browser download of `content` as a file named `filename`. */
export function downloadText(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  // Some browsers cancel the download if the blob URL is revoked synchronously after click().
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
