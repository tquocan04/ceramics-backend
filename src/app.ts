import express from 'express';
import orderRoutes from './routes/order.routes';
import batchRoutes from './routes/batch.routes';
import healthRoutes from './routes/health.routes';
import notificationRouter from './routes/notification.routes'

const app = express();

// Middleware parse JSON body
app.use(express.json());

// Register routes
app.use('/api/health', healthRoutes);

app.use('/api/orders', orderRoutes);

app.use('/api/batches', batchRoutes);

app.use('/api/notifications', notificationRouter);

export default app;