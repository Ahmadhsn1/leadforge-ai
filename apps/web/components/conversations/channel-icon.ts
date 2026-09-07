import { Instagram, Mail, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Channel } from '@leadforge/shared';

/** Icon per outreach channel, used by the inbox list and thread header. */
export const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  email: Mail,
};
