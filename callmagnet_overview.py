from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_LEFT, TA_CENTER

W, H = A4
NAVY   = colors.HexColor('#0E1419')
EMERALD= colors.HexColor('#10b981')
WHITE  = colors.white
GRAY   = colors.HexColor('#6b7280')
LGRAY  = colors.HexColor('#f3f4f6')
BLACK  = colors.HexColor('#111827')

doc = SimpleDocTemplate(
    'callmagnet_overview.pdf',
    pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm,
    topMargin=14*mm, bottomMargin=14*mm
)

def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, H - 18*mm, W, 18*mm, fill=1, stroke=0)
    canvas.setFillColor(EMERALD)
    canvas.setFont('Helvetica-Bold', 13)
    canvas.drawString(18*mm, H - 12*mm, 'CallMagnet')
    canvas.setFillColor(WHITE)
    canvas.setFont('Helvetica', 10)
    canvas.drawRightString(W - 18*mm, H - 12*mm, 'callmagnet.com.au')
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, W, 10*mm, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor('#374151'))
    canvas.setFont('Helvetica', 8)
    canvas.drawCentredString(W/2, 3.5*mm, f'Page {doc.page}  |  Confidential — CallMagnet 2025')
    canvas.restoreState()

s_title = ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=26, textColor=NAVY, spaceAfter=4, leading=30)
s_tagline = ParagraphStyle('tagline', fontName='Helvetica', fontSize=13, textColor=GRAY, spaceAfter=16, leading=18)
s_h2 = ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=14, textColor=NAVY, spaceBefore=14, spaceAfter=6, leading=18)
s_h3 = ParagraphStyle('h3', fontName='Helvetica-Bold', fontSize=11, textColor=EMERALD, spaceBefore=8, spaceAfter=4)
s_body = ParagraphStyle('body', fontName='Helvetica', fontSize=10, textColor=BLACK, leading=15, spaceAfter=4)
s_bullet = ParagraphStyle('bullet', fontName='Helvetica', fontSize=10, textColor=BLACK, leading=15, leftIndent=12, spaceAfter=3)
s_label = ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=9, textColor=EMERALD, spaceAfter=2)
s_center = ParagraphStyle('center', fontName='Helvetica', fontSize=10, textColor=GRAY, alignment=TA_CENTER, leading=14)
s_stat_n = ParagraphStyle('stat_n', fontName='Helvetica-Bold', fontSize=22, textColor=NAVY, alignment=TA_CENTER, leading=26)
s_stat_l = ParagraphStyle('stat_l', fontName='Helvetica', fontSize=9, textColor=GRAY, alignment=TA_CENTER, leading=12)

def bullet(text):
    return Paragraph(f'•  {text}', s_bullet)

def divider():
    return HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#e5e7eb'), spaceAfter=8, spaceBefore=4)

story = []

story.append(Spacer(1, 8*mm))
story.append(Paragraph('CallMagnet', s_title))
story.append(Paragraph('Turn every missed call into a booked job — automatically.', s_tagline))
story.append(divider())

# Stat row
stat_data = [
    [Paragraph('42', s_stat_n), Paragraph('2', s_stat_n), Paragraph('AU', s_stat_n), Paragraph('&lt;2 min', s_stat_n)],
    [Paragraph('edge functions', s_stat_l), Paragraph('live verticals', s_stat_l), Paragraph('market focus', s_stat_l), Paragraph('to onboard a client', s_stat_l)],
]
stat_table = Table(stat_data, colWidths=[W/4 - 12*mm]*4, hAlign='CENTER')
stat_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), LGRAY),
    ('ROWBACKGROUNDS', (0,0), (-1,-1), [LGRAY, LGRAY]),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('LEFTPADDING', (0,0), (-1,-1), 4),
    ('RIGHTPADDING', (0,0), (-1,-1), 4),
    ('ROUNDEDCORNERS', [6]),
    ('LINEABOVE', (0,0), (-1,0), 0, WHITE),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(stat_table)
story.append(Spacer(1, 10))

# Problem
story.append(Paragraph('The problem', s_h2))
story.append(Paragraph(
    'Every restaurant, salon, and trades business in Australia misses calls every day. '
    'The customer hangs up, calls the next business on Google, and the job is gone. '
    'There is no system to catch them — until now.',
    s_body))

story.append(Paragraph('The solution', s_h2))
story.append(Paragraph(
    'When a customer calls and no one answers, CallMagnet instantly sends them an SMS '
    'from the business\'s own number. The message contains a branded booking link. '
    'The customer taps it, lands on the Middle Man page, and takes action — without the business picking up.',
    s_body))

story.append(divider())

# Features in 2-col table
story.append(Paragraph('Core features', s_h2))

def feature_cell(title, points):
    items = [Paragraph(title, s_h3)]
    for p in points:
        items.append(bullet(p))
    return items

col_a = feature_cell('Missed-call SMS engine', [
    'Twilio intercepts every missed call instantly',
    'SMS sent from the business\'s own number',
    'Landline and VoIP filtering — no wasted sends',
    'Monthly SMS cap with overage pricing',
    'Opt-out compliance with full audit trail',
])
col_b = feature_cell('The Middle Man page', [
    'Custom branded landing page per client',
    'Full-screen video or image background',
    'Up to 6 neon action buttons',
    'Booking, reschedule, functions, late arrival, lost and found',
    'Works on any phone — no app required',
])
col_c = feature_cell('Owner dashboard (PWA)', [
    'Real-time: SMS sent, clicks, bookings, conversion rate',
    'Revenue recovered estimate',
    'Live customer request feed',
    'Push notifications to all owner devices',
    'Installs to iPhone and Android home screen',
])
col_d = feature_cell('Automation', [
    'Quick responder SMS if no booking in 2 hours',
    'Daily summary alerts to operator',
    'Monthly report email per client',
    'Free trial expiry warnings',
    'Stripe-triggered account reactivation',
])

feat_table = Table(
    [[col_a, col_b], [col_c, col_d]],
    colWidths=[(W - 36*mm)/2]*2,
    hAlign='LEFT'
)
feat_table.setStyle(TableStyle([
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ('TOPPADDING', (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ('BACKGROUND', (0,0), (0,0), colors.HexColor('#f0fdf4')),
    ('BACKGROUND', (1,0), (1,0), colors.HexColor('#f0fdf4')),
    ('BACKGROUND', (0,1), (0,1), colors.HexColor('#f0fdf4')),
    ('BACKGROUND', (1,1), (1,1), colors.HexColor('#f0fdf4')),
    ('LINEBELOW', (0,0), (1,0), 0.5, colors.HexColor('#d1fae5')),
    ('LINERIGHT', (0,0), (0,1), 0.5, colors.HexColor('#d1fae5')),
    ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#d1fae5')),
]))
story.append(feat_table)
story.append(Spacer(1, 6))

story.append(divider())

# Operator tools
story.append(Paragraph('Operator tools', s_h2))
op_items = [
    ('One-page onboarding', 'A new client is live in under 2 minutes — business name, Twilio number, booking URL, SMS template, pricing package.'),
    ('Middle Man manager', 'Upload logo, video background, poster frame. Set button text, colours, neon glow. Live phone preview pane.'),
    ('Client list', 'Search clients by name. See SMS count, account status, demo flags. Reset passwords. Toggle features.'),
    ('Unsubscribes admin', 'View all opted-out numbers with dates and SMS templates. Full audit trail for compliance.'),
]
op_data = [[Paragraph(t, s_label), Paragraph(d, s_body)] for t, d in op_items]
op_table = Table(op_data, colWidths=[42*mm, W - 36*mm - 42*mm], hAlign='LEFT')
op_table.setStyle(TableStyle([
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 4),
    ('RIGHTPADDING', (0,0), (-1,-1), 4),
    ('LINEBELOW', (0,0), (-1,-2), 0.4, colors.HexColor('#e5e7eb')),
]))
story.append(op_table)

story.append(divider())

# Market opportunity
story.append(Paragraph('Market opportunity', s_h2))
opp_items = [
    'Every trade, restaurant, salon and service business in Australia misses calls daily — the market is every small business with a phone.',
    'No competitor combines instant SMS + branded landing page + real-time dashboard in a single product.',
    'Pays for itself after recovering just one job per month — average job value $150-$800 depending on vertical.',
    'Low churn: the dashboard becomes a daily habit for business owners who watch their stats.',
    'Verticals live: restaurant and hairdresser. Ready to expand: trades, retail, medical, automotive, pet care.',
    'White-label potential for franchise groups and booking platform partners.',
]
for item in opp_items:
    story.append(bullet(item))

story.append(Spacer(1, 8))
story.append(divider())

# Integrations
story.append(Paragraph('Integrations', s_h2))
integrations = [
    ['Twilio SMS', 'Twilio Lookup', 'Stripe subscriptions', 'Resend email'],
    ['Progressier push', 'Supabase DB + auth', 'Rebrandly short links', 'Netlify hosting'],
]
int_table = Table(integrations, colWidths=[(W - 36*mm)/4]*4, hAlign='LEFT')
int_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), LGRAY),
    ('FONTNAME', (0,0), (-1,-1), 'Helvetica'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#374151')),
    ('TOPPADDING', (0,0), (-1,-1), 7),
    ('BOTTOMPADDING', (0,0), (-1,-1), 7),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ('ALIGN', (0,0), (-1,-1), 'CENTER'),
    ('GRID', (0,0), (-1,-1), 0.4, WHITE),
]))
story.append(int_table)

story.append(Spacer(1, 10))
story.append(Paragraph('callmagnet.com.au', ParagraphStyle('footer_link', fontName='Helvetica-Bold', fontSize=11, textColor=EMERALD, alignment=TA_CENTER)))

doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print('Done: callmagnet_overview.pdf')
