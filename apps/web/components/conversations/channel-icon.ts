import { Instagram, Mail, MessageCircle, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Channel } from '@leadforge/shared';

/** Icon per outreach channel, used by the inbox list and thread header. */
export const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  email: Mail,
  // A manual message is handed to the user to send, so the icon is the send
  // action rather than any one destination app.
  manual: Send,
};
