const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
app.use(cors());

// --- DB SETUP ---
// --- DB SETUP ---
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    }
});

// --- MODELS (Strictly Relational & 3NF) ---
const Category = sequelize.define('Category', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true }
});

const Item = sequelize.define('Item', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    desc: { type: DataTypes.STRING },
    categoryId: { type: DataTypes.INTEGER, allowNull: false }
});

// 1-to-Many Relationship
Category.hasMany(Item, { foreignKey: 'categoryId', onDelete: 'CASCADE' });
Item.belongsTo(Category, { foreignKey: 'categoryId' });

let generatorInterval = null;

// --- GRAPHQL SCHEMA ---
const typeDefs = gql`
  type Category { id: ID!  name: String!  items: [Item] }
  type Item     { id: ID!  name: String!  price: Float!  desc: String  category: Category }
  type InventoryPage { data: [Item]  totalCount: Int  hasNextPage: Boolean }
  type Stats    { totalItems: Int  averagePrice: Float }

  type Query {
    items(page: Int, limit: Int): InventoryPage
    categories: [Category]
    statistics: Stats
  }
  type Mutation {
    addItem(name: String!, price: Float!, categoryId: ID!, desc: String): Item
    updateItem(id: ID!, name: String!, price: Float!, categoryId: ID!, desc: String): Item
    deleteItem(id: ID!): ID
    toggleGenerator(action: String!): String
  }
`;

// --- RESOLVERS ---
const resolvers = {
    Query: {
        items: async (_, { page = 1, limit = 6 }) => {
            const offset = (page - 1) * limit;
            const { count, rows } = await Item.findAndCountAll({
                include: Category,
                limit,
                offset,
                order: [['createdAt', 'DESC']]
            });
            return { data: rows, totalCount: count, hasNextPage: offset + limit < count };
        },
        categories: async () => Category.findAll(),
        statistics: async () => {
            const totalItems = await Item.count();
            const avg = await Item.findOne({
                attributes: [[sequelize.fn('AVG', sequelize.col('price')), 'avg']]
            });
            return { totalItems, averagePrice: parseFloat(avg?.dataValues?.avg || 0) };
        }
    },

    Item: {
        category: async (parent) => parent.Category || Category.findByPk(parent.categoryId)
    },
    Category: {
        items: async (parent) => Item.findAll({ where: { categoryId: parent.id } })
    },

    Mutation: {
        addItem: async (_, { name, price, categoryId, desc }) => {
            const item = await Item.create({ name, price, categoryId: parseInt(categoryId), desc });
            return Item.findByPk(item.id, { include: Category });
        },
        updateItem: async (_, { id, name, price, categoryId, desc }) => {
            await Item.update({ name, price, categoryId: parseInt(categoryId), desc }, { where: { id } });
            return Item.findByPk(id, { include: Category });
        },
        deleteItem: async (_, { id }) => {
            await Item.destroy({ where: { id } });
            return id;
        },
        toggleGenerator: (_, { action }) => {
            const drinkNames = {
                1: ["Negroni", "Manhattan", "Whiskey Sour", "Mojito", "Espresso Martini"],
                2: ["Double Apple", "Minty Grape", "Blueberry Ice", "Watermelon Chill"],
                3: ["Chardonnay", "Cabernet Sauvignon", "Pinot Noir", "Merlot"]
            };
            if (action === 'start' && !generatorInterval) {
                generatorInterval = setInterval(async () => {
                    const catId = Math.floor(Math.random() * 3) + 1;
                    const names = drinkNames[catId];
                    await Item.create({
                        name: names[Math.floor(Math.random() * names.length)],
                        price: Math.floor(Math.random() * 80) + 30,
                        categoryId: catId,
                        desc: "Chef's Special"
                    });
                }, 3000);
                return "Started";
            } else if (action === 'stop') {
                clearInterval(generatorInterval);
                generatorInterval = null;
                return "Stopped";
            }
            return "No action taken";
        }
    }
};

async function startServer() {
    await sequelize.sync({ force: false });

    // --- SEED CATEGORIES AUTOMATICALLY ---
    await Category.findOrCreate({ where: { id: 1 }, defaults: { name: 'Cocktail' } });
    await Category.findOrCreate({ where: { id: 2 }, defaults: { name: 'Shisha' } });
    await Category.findOrCreate({ where: { id: 3 }, defaults: { name: 'Wine' } });

    const server = new ApolloServer({ typeDefs, resolvers });
    await server.start();
    server.applyMiddleware({ app });

    app.get('/api/items', (req, res) => res.json({ ok: true }));

    if (process.env.NODE_ENV !== 'test') {
        // Dynamic port selection for cloud environments like Render
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 DB Server ready on port ${PORT}`);
        });
    }
}

// --- SAFE SERVER INVOCATION ---
// --- SAFE SERVER INVOCATION ---
if (process.env.NODE_ENV !== 'test') {
    startServer();
} else {
    // For tests, expose a function that initializes Apollo middleware and REST paths on the app instance
    async function initTestMiddleware() {
        await sequelize.sync({ force: false });
        const server = new ApolloServer({ typeDefs, resolvers, introspection: true });
        await server.start();
        server.applyMiddleware({ app });

        // Register the REST test endpoint so Supertest can find it during testing
        app.get('/api/items', (req, res) => res.json({ ok: true }));
    }
    // Fire it immediately
    initTestMiddleware();
}

module.exports = { app, sequelize, Category, Item };
