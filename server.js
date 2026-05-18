const express = require('express');
const { ApolloServer, gql } = require('apollo-server-express');
const cors = require('cors');

const app = express();
app.use(cors());
// Note: app.use(express.json()) was intentionally removed to fix the stream error!

// --- 1-to-Many RAM Storage ---
let categories = [
    { id: "1", name: "Cocktail" },
    { id: "2", name: "Shisha" },
    { id: "3", name: "Wine" }
];

let inventory = [
    { id: "1", name: "Old Fashioned", price: 72, categoryId: "1", desc: "Classic" },
    { id: "2", name: "Premium Shisha", price: 500, categoryId: "2", desc: "Top shelf" },
    { id: "3", name: "Red Wine Reserve", price: 120, categoryId: "3", desc: "Aged oak" }
];

let generatorInterval = null;

// --- GRAPHQL SCHEMA ---
const typeDefs = gql`
  type Category {
    id: ID!
    name: String!
    items: [Item]
  }

  type Item {
    id: ID!
    name: String!
    price: Float!
    desc: String
    category: Category
  }

  type InventoryPage {
    data: [Item]
    totalCount: Int
    hasNextPage: Boolean
  }

  type Stats {
    totalItems: Int
    averagePrice: Float
  }

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

// --- GRAPHQL RESOLVERS ---
const resolvers = {
    Query: {
        items: (_, { page = 1, limit = 6 }) => {
            const start = (page - 1) * limit;
            const end = start + limit;
            return {
                data: inventory.slice(start, end), // Classic Page Slice
                totalCount: inventory.length,
                hasNextPage: end < inventory.length
            };
        },
        categories: () => categories,
        statistics: () => ({
            totalItems: inventory.length,
            averagePrice: inventory.length > 0 ? (inventory.reduce((sum, item) => sum + item.price, 0) / inventory.length) : 0
        })
    },
    Item: {
        category: (parent) => categories.find(c => c.id === parent.categoryId)
    },
    Category: {
        items: (parent) => inventory.filter(i => i.categoryId === parent.id)
    },
    Mutation: {
        addItem: (_, { name, price, categoryId, desc }) => {
            const newItem = { id: String(Date.now()), name, price, categoryId, desc };
            inventory.unshift(newItem);
            return newItem;
        },
        updateItem: (_, { id, name, price, categoryId, desc }) => {
            const index = inventory.findIndex(i => i.id === id);
            if (index !== -1) {
                inventory[index] = { id, name, price, categoryId, desc };
                return inventory[index];
            }
            return null;
        },
        deleteItem: (_, { id }) => {
            inventory = inventory.filter(i => i.id !== id);
            return id;
        },
        toggleGenerator: (_, { action }) => {
            if (action === 'start' && !generatorInterval) {
                // Real Drink Name Bank
                const drinkNames = {
                    "1": ["Negroni", "Manhattan", "Whiskey Sour", "Mojito", "Espresso Martini", "Paloma", "Aperol Spritz"],
                    "2": ["Double Apple", "Minty Grape", "Blueberry Ice", "Watermelon Chill", "Lemon Mint", "Persian Rose"],
                    "3": ["Chardonnay", "Cabernet Sauvignon", "Pinot Noir", "Merlot", "Sauvignon Blanc", "Rosé Reserve"]
                };

                generatorInterval = setInterval(() => {
                    const categories = ["1", "2", "3"];
                    const randomCatId = categories[Math.floor(Math.random() * categories.length)];
                    const possibleNames = drinkNames[randomCatId];
                    const chosenName = possibleNames[Math.floor(Math.random() * possibleNames.length)];
                    const randomPrice = Math.floor(Math.random() * 80) + 30;

                    inventory.unshift({
                        id: String(Date.now()),
                        name: chosenName,
                        price: randomPrice,
                        categoryId: randomCatId,
                        desc: "Chef's Special Recommendation"
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

const server = new ApolloServer({ typeDefs, resolvers });

// ... keep all your existing code above ...

async function startServer() {
    await server.start();
    server.applyMiddleware({ app });

    app.get('/api/items', (req, res) => res.json({ ok: true }));

    // ONLY listen if this file is run directly (not by Jest)
    if (process.env.NODE_ENV !== 'test') {
        app.listen(5000, () => console.log('🚀 Gold GraphQL Server ready'));
    }
}

startServer();

// EXPORT both app and the apollo server for the tests
module.exports = { app, server };