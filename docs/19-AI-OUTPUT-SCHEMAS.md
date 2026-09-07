# AI Output Schemas

## Business analysis

{
summary: string,
strengths: string[],
pain_points: [
{ statement, evidence_ids, confidence }
],
opportunities: [
{ statement, evidence_ids, confidence }
],
recommended_angle: string,
unknowns: string[]
}

## Lead score

{
total: number,
dimensions: {
fit: number,
opportunity: number,
contactability: number,
maturity: number,
confidence: number,
urgency: number
},
explanation: string[]
}

## Message

{
channel: string,
body: string,
angle: string,
cta: string,
validation_targets: string[]
}
