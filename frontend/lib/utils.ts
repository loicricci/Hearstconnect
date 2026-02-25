/**
 * Utility functions for Hearst Connect.
 */

export function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBTC(value: number): string {
  if (value === 0) return '0.00000000';
  if (Math.abs(value) < 0.00000001) return '~0';
  return value.toFixed(8);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function exportAsJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportAsCSV(rows: Record<string, any>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(h => {
      const val = row[h];
      return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
    }).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function classNames(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export async function exportAsPDF(
  element: HTMLElement,
  filename: string,
  onStart?: () => void,
  onEnd?: () => void,
) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  onStart?.();

  try {
    element.classList.add('pdf-capture');
    await new Promise((r) => setTimeout(r, 100));

    const canvas = await html2canvas(element, {
      backgroundColor: '#0a0a0a',
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: element.scrollWidth,
      windowHeight: element.scrollHeight,
    });

    element.classList.remove('pdf-capture');

    const imgData = canvas.toDataURL('image/png');
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;

    const pdfWidth = 297; // A4 landscape width in mm
    const pdfHeight = 210; // A4 landscape height in mm
    const margin = 10;
    const usableWidth = pdfWidth - margin * 2;

    const scaledHeight = (imgHeight * usableWidth) / imgWidth;
    const usableHeight = pdfHeight - margin * 2;

    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    // Multi-page: slice the image across pages if it's tall
    let yOffset = 0;
    let page = 0;
    while (yOffset < scaledHeight) {
      if (page > 0) pdf.addPage();

      const srcY = (yOffset / scaledHeight) * imgHeight;
      const srcH = Math.min(
        (usableHeight / scaledHeight) * imgHeight,
        imgHeight - srcY,
      );
      const destH = (srcH / imgHeight) * scaledHeight;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = imgWidth;
      sliceCanvas.height = Math.ceil(srcH);
      const ctx = sliceCanvas.getContext('2d')!;
      ctx.drawImage(
        canvas,
        0, Math.floor(srcY), imgWidth, Math.ceil(srcH),
        0, 0, imgWidth, Math.ceil(srcH),
      );

      const sliceData = sliceCanvas.toDataURL('image/png');
      pdf.addImage(sliceData, 'PNG', margin, margin, usableWidth, destH);

      // Footer
      pdf.setFontSize(7);
      pdf.setTextColor(120);
      pdf.text(
        `Hearst Connect — ${filename.replace('.pdf', '')} — Page ${page + 1}`,
        margin,
        pdfHeight - 4,
      );

      yOffset += usableHeight;
      page++;
    }

    pdf.save(filename);
  } finally {
    element.classList.remove('pdf-capture');
    onEnd?.();
  }
}
