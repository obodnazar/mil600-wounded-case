#!/usr/bin/env python3
"""Друкована одна сторінка з канонічного Markdown, без скорочення змісту."""
from argparse import ArgumentParser
from html import escape
from urllib.parse import urljoin
from pathlib import Path
import re
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph

ROOT = Path(__file__).resolve().parents[1]
parser = ArgumentParser(description=__doc__)
parser.add_argument('--font-dir', type=Path, default=Path('/usr/share/fonts/truetype/dejavu'))
parser.add_argument('--output', type=Path, default=ROOT / 'output/pdf/pitch-one-pager.pdf')
args = parser.parse_args()
for name, filename in [('DejaVu', 'DejaVuSans.ttf'), ('DejaVu-Bold', 'DejaVuSans-Bold.ttf')]:
    font = args.font_dir / filename
    if not font.is_file():
        parser.error(f'Немає {filename}; передайте --font-dir')
    pdfmetrics.registerFont(TTFont(name, str(font)))
pdfmetrics.registerFontFamily('DejaVu', normal='DejaVu', bold='DejaVu-Bold')
ink = colors.HexColor('#242820')
styles = {
    'title': ParagraphStyle('title', fontName='DejaVu-Bold', fontSize=22, leading=26, textColor=ink, spaceAfter=9),
    'heading': ParagraphStyle('heading', fontName='DejaVu-Bold', fontSize=11.3, leading=14, textColor=ink, spaceBefore=9, spaceAfter=4, keepWithNext=True),
    'body': ParagraphStyle('body', fontName='DejaVu', fontSize=10.1, leading=14.1, textColor=ink, spaceAfter=5, alignment=TA_LEFT),
    'note': ParagraphStyle('note', fontName='DejaVu', fontSize=8, leading=11, textColor=colors.HexColor('#505747'), spaceAfter=6),
}

def inline(text):
    # PDF uses ordinary ASCII hyphens. Markdown remains the canonical source.
    text = text.replace('—', '-').replace('–', '-')
    text = escape(text)
    def link(m):
        label, href = m.groups()
        if not href.startswith('https://'):
            href = urljoin('https://github.com/obodnazar/mil600-wounded-case/blob/main/docs/', href)
        return f'<link href="{href}" color="#455b37"><u>{label}</u></link>'
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, text)
    return re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)

blocks = (ROOT / 'docs/pitch-one-pager.md').read_text().strip().split('\n\n')
story = []
for i, block in enumerate(blocks):
    kind = 'title' if block.startswith('# ') else 'heading' if block.startswith('## ') else 'note' if i in (1, len(blocks)-1) else 'body'
    block = re.sub(r'^#{1,2}\s+', '', block)
    story.append(Paragraph(inline(block.replace('\n', ' ')), styles[kind]))
args.output.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(args.output), pagesize=A4, leftMargin=40, rightMargin=40, topMargin=32, bottomMargin=30, title='Кейс поранення - одна сторінка пітчу', author='MIL600 / підготовлено з використанням ШІ', pageCompression=1)

def page(canvas, document):
    canvas.setStrokeColor(colors.HexColor('#c8bfa9'))
    canvas.line(40, 25, A4[0]-40, 25)
    canvas.setFillColor(colors.HexColor('#d96c36'))
    canvas.rect(40, A4[1]-19, 36, 3, fill=1, stroke=0)

doc.build(story, onFirstPage=page, onLaterPages=page)
reader = PdfReader(args.output)
if len(reader.pages) != 1:
    args.output.unlink()
    raise SystemExit(f'Очікувалася 1 сторінка, отримано {len(reader.pages)}. Відкоригуйте макет; текст не скорочуйте.')
text = reader.pages[0].extract_text()
if not all(s in text for s in ['Кейс поранення', 'Яке рішення просимо', 'Дані демо вигадані']):
    raise SystemExit('Не вдалося витягти ключовий український текст')
print(f'OK: {args.output.name}; 1 сторінка; український текст витягується. Потрібен візуальний огляд.')
