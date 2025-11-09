import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

console.log('Connecting to Redis:', REDIS_URL);

export const redis = new Redis(REDIS_URL, {
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
  console.log('Redis connected successfully');
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err.message);
});

redis.on('ready', () => {
  console.log('Redis ready to accept commands');
});

