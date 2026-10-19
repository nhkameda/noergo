import { answerInteraction } from '@/lib/consent';

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  return answerInteraction(req, (await params).uid, 'abort');
}
