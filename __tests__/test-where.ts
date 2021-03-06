import { User } from './entities/user'
import { Post } from './entities/post'
import { query, setupTest, create } from './util'

describe('Where', () => {
  setupTest()

  async function setupFixture() {
    const userFoo = await create(User, {age: 20, name: 'foo'})
    const userBar = await create(User, {age: 30, name: 'bar'})
    await create(User, {age: 40, name: 'baz'})
    await create(User, {age: 50, name: 'quz'})
    await create(Post, {user: userFoo, title: 'foo post'})
    await create(Post, {user: userBar, title: 'bar post'})
  }

  beforeEach(async () => {
    await setupFixture()
  })

  it('handles OR clause', async () => {
    const result = await query(`
      query {
        users(where: {
          OR: [
            {
              age: 20
            },
            {
              name: "bar"
            },
            {
              age: 50,
            }
          ]
        }) {
          id
          name
          age
        }
      }`
    )

    expect(result.data!.users).toHaveLength(3)
    expect(result.data).toMatchObject({
      users: expect.arrayContaining([
        {
          age: 20,
          id: expect.any(Number),
          name: 'foo',
        },
        {
          age: 30,
          id: expect.any(Number),
          name: 'bar',
        },
        {
          age: 50,
          id: expect.any(Number),
          name: 'quz',
        }
      ]),
    })
  })

  it('handles simple operations', async () => {
    const result = await query(`
      query {
        users(where: {
          age_gt: 35,
          age_lt: 50
        }) {
          id
          name
          age
        }
      }`
    )

    expect(result.data).toMatchObject({
      users: [
        {
          age: 40,
          id: expect.any(Number),
          name: 'baz',
        }
      ],
    })
  })

  it('handles NOT operation', async () => {
    const result = await query(`
      query UsersExceptSomeAges($first: Int, $second: Int) {
        users(where: {
          NOT: {
            OR: [{
              age: $first,
            }, {
              age: $second,
            }]
          }
        }) {
          age
        }
      }
    `, {
      first: 30,
      second: 40,
    })

    expect(result.data!.users).toHaveLength(2)
    expect(result.data).toMatchObject({
      users: expect.arrayContaining([
        {
          age: 20,
        },
        {
          age: 50,
        },
      ]),
    })
  })

  it('handles nested where', async () => {
    const result = await query(`
      query {
        users(where: {
          name_in: ["foo", "bar"]
        }) {
          id
          name
          posts(where: {
            title: "foo post"
          }) {
            id
            title
          }
        }
      }
    `)

    expect(result.data!.users).toHaveLength(2)
    expect(result.data).toMatchObject({
      users: expect.arrayContaining([
        {
          id: expect.any(Number),
          name: 'foo',
          posts: [
            {
              id: expect.any(Number),
              title: 'foo post',
            }
          ]
        },
        {
          id: expect.any(Number),
          name: 'bar',
          posts: []
        }
      ])
    })
  })
})
