/**
 * Loader for Paddle.js, the payment provider's hosted checkout.
 *
 * It is fetched only when someone actually starts an upgrade, so no third-party
 * script runs on any other screen. Card details are entered in Paddle's own
 * overlay and never touch this application.
 */

const PADDLE_SRC = 'https://cdn.paddle.com/paddle/v2/paddle.js';

interface PaddleEventData {
  name?: string;
}

interface PaddleGlobal {
  Environment: { set(environment: 'sandbox' | 'production'): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleEventData) => void }): void;
  Checkout: {
    open(options: { transactionId: string; settings?: Record<string, unknown> }): void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

let loading: Promise<PaddleGlobal> | null = null;
// Paddle allows one Initialize per page; the current listener is swapped in
// behind a stable callback instead.
let listener: ((event: PaddleEventData) => void) | null = null;

function loadScript(): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle);

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PADDLE_SRC;
    script.async = true;
    script.onload = () =>
      window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js did not initialise'));
    script.onerror = () => reject(new Error('Paddle.js could not be loaded'));
    document.head.appendChild(script);
  });
}

export async function openPaddleCheckout(options: {
  environment: 'sandbox' | 'production';
  clientToken: string;
  transactionId: string;
  onCompleted: () => void;
  onClosed: () => void;
}): Promise<void> {
  if (!loading) {
    loading = loadScript().then((paddle) => {
      if (options.environment === 'sandbox') paddle.Environment.set('sandbox');
      paddle.Initialize({
        token: options.clientToken,
        eventCallback: (event) => listener?.(event),
      });
      return paddle;
    });
    // A failed load must not poison every later attempt.
    loading.catch(() => {
      loading = null;
    });
  }

  const paddle = await loading;

  listener = (event) => {
    if (event.name === 'checkout.completed') options.onCompleted();
    if (event.name === 'checkout.closed') options.onClosed();
  };

  paddle.Checkout.open({
    transactionId: options.transactionId,
    settings: { displayMode: 'overlay' },
  });
}
