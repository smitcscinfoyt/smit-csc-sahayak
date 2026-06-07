import 'dotenv/config';
  import app from './app.js';

  // Default to 5001 — avoids port conflict with smit-csc-info (port 5000)
  const port = Number(process.env['PORT'] ?? 5001);

  if (Number.isNaN(port) || port <= 0) {
    console.error(`[Smit AI Sahayak] Invalid PORT value: "${process.env['PORT']}"`);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`[Smit AI Sahayak] Server listening on port ${port}`);
  });
  