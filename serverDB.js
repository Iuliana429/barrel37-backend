const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
app.use(cors());

// --- DB SETUP ---
const env = process.env.NODE_ENV || 'development';
const config = require('./config/config.json')[env];
const sequelize = new Sequelize(config);

// --- MODELS ---
const Category = sequelize.define('Category', {
    name: { type: DataTypes.STRING, allowNull: false }
});

const Item = sequelize.define('Item', {
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    desc: { type: DataTypes.STRING },
    categoryId: { type: DataTypes.INTEGER, allowNull: false }
});

// 1-to-Many
Category.hasMany(Item, { foreignKey: 'categoryId' });
Item.belongsTo(Category, { foreignKey: 'categoryId' });

let generatorInterval = null;

// --- GRAPHQL SCHEMA (same as your original server.js) ---
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

// --- RESOLVERS (now using Sequelize instead of RAM) ---
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
            const item = await Item.create({ name, price, categoryId, desc });
            return Item.findByPk(item.id, { include: Category });
        },
        updateItem: async (_, { id, name, price, categoryId, desc }) => {
            await Item.update({ name, price, categoryId, desc }, { where: { id } });
            return Item.findByPk(id, { include: Category });
        },
        deleteItem: async (_, { id }) => {
            await Item.destroy({ where: { id } });
            return id;
        },
        toggleGenerator: (_, { action }) => {
            const drinkNames = {
                "1": ["Negroni", "Manhattan", "Whiskey Sour", "Mojito", "Espresso Martini"],
                "2": ["Double Apple", "Minty Grape", "Blueberry Ice", "Watermelon Chill"],
                "3": ["Chardonnay", "Cabernet Sauvignon", "Pinot Noir", "Merlot"]
            };
            if (action === 'start' && !generatorInterval) {
                generatorInterval = setInterval(async () => {
                    const catId = String(Math.floor(Math.random() * 3) + 1);
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
   // await sequelize.sync({ alter: true });
    await sequelize.sync({ force: false });

    const server = new ApolloServer({ typeDefs, resolvers });
    await server.start();
    server.applyMiddleware({ app });

    app.get('/api/items', (req, res) => res.json({ ok: true }));

    if (process.env.NODE_ENV !== 'test') {
        app.listen(5000, () => console.log('🚀 DB Server ready at http://localhost:5000/graphql'));
    }
}

startServer();

module.exports = { app, sequelize, Category, Item };