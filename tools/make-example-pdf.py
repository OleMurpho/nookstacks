"""Build web/demo/example-sheet.pdf.

A synthetic two-page document for trying the PDF viewer: real text in a built-in
font and vector artwork, so it stays sharp at any zoom. The old file was a single
1240x1754 bitmap, which is why it looked soft the moment it was magnified.

    /tmp/pdfenv/bin/python tools/make-example-pdf.py
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT

OUT = "web/demo/example-sheet.pdf"
W, H = A4
INK = colors.HexColor("#1b2430")
MUTED = colors.HexColor("#5b6b7c")
RULE = colors.HexColor("#c9d4de")
ACCENT = colors.HexColor("#c98a2e")

styles = getSampleStyleSheet()
body = styles["BodyText"].clone("body")
body.fontName, body.fontSize, body.leading = "Helvetica", 9.5, 14
body.alignment = TA_LEFT

def para(c, text, x, y, width, style=body):
    p = Paragraph(text, style)
    _, h = p.wrap(width, 400)
    p.drawOn(c, x, y - h)
    return y - h

def header(c, title, kicker):
    c.setFillColor(ACCENT)
    c.rect(20 * mm, H - 26 * mm, 8 * mm, 3 * mm, stroke=0, fill=1)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20 * mm, H - 36 * mm, title)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, H - 42 * mm, kicker)
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(20 * mm, H - 46 * mm, W - 20 * mm, H - 46 * mm)
    return H - 54 * mm

def footer(c, page):
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawString(20 * mm, 14 * mm, "Example Sheet \u2014 synthetic content, not a real document")
    c.drawRightString(W - 20 * mm, 14 * mm, f"page {page} of 2")

c = canvas.Canvas(OUT, pagesize=A4)
c.setTitle("Example Sheet")
c.setAuthor("Nookstacks")
c.setSubject("A synthetic document used to demonstrate the PDF viewer")
c.setCreator("tools/make-example-pdf.py")

# ---------------------------------------------------------------- page one
y = header(c, "Example Sheet", "A made-up document, drawn as vectors rather than a picture")
y = para(c, "This page exists so that a nookstacks board has a real PDF to open: "
            "text you can select, a table, and a chart drawn with paths. Magnify it "
            "as far as you like and the edges stay sharp, because none of it is a "
            "bitmap.", 20 * mm, y, W - 40 * mm)
y -= 6 * mm

c.setFillColor(INK); c.setFont("Helvetica-Bold", 11)
c.drawString(20 * mm, y, "Line items")
y -= 6 * mm

cols = [20 * mm, 62 * mm, 96 * mm, 132 * mm]
rows = [
    ("Region", "Owner", "Status", "Hours"),
    ("North quay", "Example team", "In progress", "12.5"),
    ("Salt marsh", "Example team", "Blocked", "3.0"),
    ("Old viaduct", "Examples Ltd", "Review", "21.0"),
    ("Sea wall", "Examples Ltd", "Done", "8.25"),
]
c.setFont("Helvetica-Bold", 8.5)
c.setFillColor(MUTED)
for i, (x, cell) in enumerate(zip(cols, rows[0])):
    if i == 3:
        c.drawRightString(W - 20 * mm, y, cell)
    else:
        c.drawString(x, y, cell)
y -= 2 * mm
c.setStrokeColor(RULE); c.line(20 * mm, y, W - 20 * mm, y)
y -= 5 * mm
c.setFont("Helvetica", 9)
for row in rows[1:]:
    c.setFillColor(INK)
    for i, (x, cell) in enumerate(zip(cols, row)):
        if i == 3:
            c.drawRightString(W - 20 * mm, y, cell)
        else:
            c.drawString(x, y, cell)
    y -= 7 * mm
c.setStrokeColor(RULE); c.line(20 * mm, y + 2 * mm, W - 20 * mm, y + 2 * mm)

# vector bar chart
y -= 14 * mm
c.setFillColor(INK); c.setFont("Helvetica-Bold", 11)
c.drawString(20 * mm, y, "Hours by region")
y -= 8 * mm
base, height, bw = y - 30 * mm, 26 * mm, 14 * mm
values = [12.5, 3.0, 21.0, 8.25]
names = ["North quay", "Salt marsh", "Old viaduct", "Sea wall"]
c.setStrokeColor(RULE); c.setLineWidth(0.6)
c.line(20 * mm, base, 20 * mm + 4 * (bw + 8 * mm), base)
for i, (v, nm) in enumerate(zip(values, names)):
    x = 20 * mm + 4 * mm + i * (bw + 8 * mm)
    c.setFillColor(colors.HexColor("#2f6f8f") if i % 2 == 0 else colors.HexColor("#3f8a63"))
    c.rect(x, base, bw, height * v / 21.0, stroke=0, fill=1)
    c.setFillColor(MUTED); c.setFont("Helvetica", 7.5)
    c.drawCentredString(x + bw / 2, base - 4 * mm, nm)
    c.setFillColor(INK); c.setFont("Helvetica", 8)
    c.drawCentredString(x + bw / 2, base + height * v / 21.0 + 2 * mm, f"{v:g}")
# closing prose, so the page does not end in the middle
y = base - 26 * mm
c.setFillColor(INK); c.setFont("Helvetica-Bold", 11)
c.drawString(20 * mm, y, "Remarks")
y -= 7 * mm
y = para(c, "The numbers above are invented, but their proportions are not random: the "
            "viaduct carries the bulk of the work, the marsh almost none of it, and the "
            "two teams are split evenly across four sites.", 20 * mm, y, W - 40 * mm)
y -= 4 * mm
y = para(c, "A document like this is a useful test subject precisely because it is "
            "text-heavy and vector-clean. If a viewer shows it soft, the viewer is "
            "scaling a bitmap instead of setting type; if it shows it sharp and "
            "selectable, everything underneath is working the way it should.", 20 * mm, y, W - 40 * mm)
footer(c, 1)
c.showPage()

# ---------------------------------------------------------------- page two
y = header(c, "Notes", "The second page, so the viewer has something to page to")
c.setFillColor(INK); c.setFont("Helvetica-Bold", 11)
c.drawString(20 * mm, y, "Why this file is here")
y -= 7 * mm
for line in [
    "To give the PDF card something with real type in it, at any zoom.",
    "To prove that paging, zooming and text selection all work in the viewer.",
    "To keep the example content obviously fake: no names, no addresses, no dates.",
]:
    c.setFillColor(ACCENT); c.circle(22 * mm, y + 1.1 * mm, 1.1 * mm, stroke=0, fill=1)
    c.setFillColor(INK); c.setFont("Helvetica", 9.5)
    c.drawString(26 * mm, y, line)
    y -= 6.5 * mm

y -= 6 * mm
y = para(c, "A short paragraph in the middle of the page, so the document does not "
            "read as a title followed by a list. The point of vector text is the "
            "small print: it stays legible when the card is small and when the page "
            "is magnified past four hundred percent.", 20 * mm, y, W - 40 * mm)
y -= 8 * mm

# a small vector diagram
c.setStrokeColor(MUTED); c.setLineWidth(1)
c.setFillColor(colors.HexColor("#eef3f7"))
box_y = y - 20 * mm
for i, label in enumerate(["board", "card", "viewer"]):
    x = 24 * mm + i * 44 * mm
    c.roundRect(x, box_y, 32 * mm, 14 * mm, 2 * mm, stroke=1, fill=1)
    c.setFillColor(INK); c.setFont("Helvetica", 8.5)
    c.drawCentredString(x + 16 * mm, box_y + 5.5 * mm, label)
    c.setFillColor(colors.HexColor("#eef3f7"))
    if i < 2:
        c.setStrokeColor(MUTED)
        c.line(x + 32 * mm, box_y + 7 * mm, x + 44 * mm, box_y + 7 * mm)
        c.line(x + 41 * mm, box_y + 7 * mm, x + 39 * mm, box_y + 9 * mm)
        c.line(x + 41 * mm, box_y + 7 * mm, x + 39 * mm, box_y + 5 * mm)
footer(c, 2)
c.showPage()
c.save()
print("wrote", OUT)
