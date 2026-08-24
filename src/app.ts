import express from 'express';
import orderRoutes from './routes/order.routes';
import batchRoutes from './routes/batch.routes';
import healthRoutes from './routes/health.routes';

const app = express();

// Middleware parse JSON body
app.use(express.json());

// Register routes
app.use('/api/health', healthRoutes);

app.use('/api/orders', orderRoutes);

app.use('/api/batches', batchRoutes);

export default app;