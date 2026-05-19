const request = require('supertest');
//const { app, sequelize, Category, Item } = require('./serverDB'); -> A3 bronze
const { app, sequelize, Category, Item, User, Role, Permission } = require('./serverDB');

beforeAll(async () => {
    // 1. Force clear and reconstruct the database tables cleanly
    await sequelize.sync({ force: true });

    // 2. Explicitly seed the required 3NF Categories so relationships work
    await Category.create({ id: 1, name: 'Cocktail' });
    await Category.create({ id: 2, name: 'Shisha' });
    await Category.create({ id: 3, name: 'Wine' });

    // 3. Create a dummy item attached to the Cocktail category for queries
    await Item.create({ name: 'Negroni', price: 60, categoryId: 1, desc: 'Test' });

    // 4. Give Apollo Server a brief moment to finish binding to the app instance
    await new Promise(resolve => setTimeout(resolve, 500));
});

afterAll(async () => {
    // Close the database connection clean and square after all assertions complete
    await sequelize.close();
});

const query = (body) =>
    request(app).post('/graphql').send(body).set('Content-Type', 'application/json');

test('GET /api/items returns ok', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
});

test('GraphQL: fetch items', async () => {
    const res = await query({ query: '{ items { data { id name price } totalCount } }' });
    expect(res.status).toBe(200);
    expect(res.body.data.items.totalCount).toBeGreaterThan(0);
});

test('GraphQL: add item', async () => {
    const res = await query({
        query: `mutation { addItem(name: "Test Drink", price: 55, categoryId: "1") { id name } }`
    });
    expect(res.body.data.addItem.name).toBe('Test Drink');
});

test('GraphQL: update item', async () => {
    const add = await query({
        query: `mutation { addItem(name: "Before", price: 10, categoryId: "1") { id } }`
    });
    const id = add.body.data.addItem.id;
    const res = await query({
        query: `mutation { updateItem(id: "${id}", name: "After", price: 20, categoryId: "1") { name } }`
    });
    expect(res.body.data.updateItem.name).toBe('After');
});

test('GraphQL: delete item', async () => {
    const add = await query({
        query: `mutation { addItem(name: "ToDelete", price: 10, categoryId: "1") { id } }`
    });
    const id = add.body.data.addItem.id;
    const del = await query({ query: `mutation { deleteItem(id: "${id}") }` });
    expect(del.body.data.deleteItem).toBe(id);
});

test('GraphQL: statistics', async () => {
    const res = await query({ query: '{ statistics { totalItems averagePrice } }' });
    expect(res.body.data.statistics.totalItems).toBeGreaterThan(0);
    expect(res.body.data.statistics.averagePrice).toBeGreaterThan(0);
});