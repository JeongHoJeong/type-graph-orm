import { Post } from './entities/post'
import { User, UserType } from './entities/user'
import { query, setupTest, create } from './util'

describe('Basic', () => {
  setupTest()

  async function setupFixture() {
    const user = await create<User>(User, {
      age: 3,
      name: 'Jeong',
      type: UserType.NORMAL,
    })
    await create(Post, {
      user,
      title: 'hello',
    })
  }

  beforeEach(async () => {
    await setupFixture()
  })

  it('handles basic query', async () => {
    const result = await query(`{
      users {
        id
        name
        age
        type
        reversedName
        numPosts
      }
    }`)

    expect(result.data).toMatchObject({
      users: [
        {
          age: 3,
          id: expect.any(Number),
          name: 'Jeong',
          type: UserType.NORMAL,
          reversedName: 'gnoeJ',
          numPosts: 1,
        },
      ],
    })
  })

  it('resolves 1:n query', async () => {
    const result = await query(`{
      users {
        id
        posts {
          id
          title
          isPublic
          createdAt
        }
      }
    }`)

    const postCreatedAtString = result.data!.users[0].posts[0].createdAt
    const postCreatedAt = new Date(postCreatedAtString)
    const now = new Date()

    expect(Math.abs(now.getTime() - postCreatedAt.getTime())).toBeLessThan(1000)

    expect(result.data).toMatchObject({
      users: [
        {
          id: expect.any(Number),
          posts: [
            {
              id: expect.any(Number),
              title: 'hello',
              isPublic: false,
            },
          ],
        },
      ],
    })
  })

  it('resolves recursive query', async () => {
    const result = await query(`{
      users {
        id
        posts {
          id
          user {
            id
            posts {
              title
            }
          }
        }
      }
    }`)

    expect(result.data).toMatchObject({
      users: [
        {
          id: expect.any(Number),
          posts: [
            {
              id: expect.any(Number),
              user: {
                id: expect.any(Number),
                posts: [
                  {
                    title: 'hello',
                  },
                ],
              },
            },
          ],
        }
      ]
    })
  })
})
