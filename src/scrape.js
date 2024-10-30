import { load } from "cheerio";
import { AutoRouter } from "itty-router";
const router = AutoRouter();

async function getTrendingMovies() {
  try {
    const response = await fetch("https://trakt.tv/movies/trending", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const html = await response.text();
    const $ = load(html);

    const trendingMovies = [];

    $(".grid-item").each((i, elem) => {
      const titleElement = $(elem).find(".titles h3");
      const title = titleElement.text().trim();
      const watchersText = $(elem).find(".titles h4").text().trim();
      const watchers = parseInt(watchersText.replace(" people watching", ""));

      if (i === 8) {
        return false; // Break after 8 items
      }

      if (title && !isNaN(watchers)) {
        trendingMovies.push({
          title,
          watchers,
          timestamp: new Date().toISOString(),
        });
      }
    });

    console.log("Trending movies collected");
    return trendingMovies;
  } catch (error) {
    console.error("An error occurred while fetching movies:", error);
    throw error; // Propagate the error up
  }
}

async function updateDatabase(trendingMovies, env) {
  if (!env?.TRENDING_MOVIES) {
    throw new Error("KV namespace MOVIES is not available");
  }

  console.log("Updating database using Workers KV");

  try {
    // Get existing movies to check for duplicates
    const existingMovies = await env.TRENDING_MOVIES.get("TRENDING_MOVIES");
    const existingData = existingMovies ? JSON.parse(existingMovies) : [];

    // Filter out movies that already exist
    const newMovies = trendingMovies.filter(
      (movie) =>
        !existingData.some(
          (existing) =>
            existing.title === movie.title &&
            existing.watchers === movie.watchers
        )
    );

    if (newMovies.length > 0) {
      // Store all movies (new and existing) in KV
      const updatedMovies = [...newMovies, ...existingData].slice(0, 8); // Keep only the latest 8 movies

      await env.TRENDING_MOVIES.put(
        "TRENDING_MOVIES",
        JSON.stringify(updatedMovies)
      );
      console.log(`${newMovies.length} new movies added to the database`);
      return newMovies;
    } else {
      console.log("No new movies to add");
      return [];
    }
  } catch (error) {
    console.error("Error updating database:", error);
    throw error; // Propagate the error up
  }
}

// Root route handler
router.get("/", async (request, env, ctx) => {
  console.log(env);
  try {
    // Validate env object
    if (!env?.TRENDING_MOVIES) {
      throw new Error("KV namespace MOVIES is not configured");
    }

    const trendingMovies = await getTrendingMovies();
    const updatedMovies = await updateDatabase(trendingMovies, env);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Updated ${updatedMovies.length} new movies`,
        data: updatedMovies,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error in root route:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Failed to update movies",
        error: error.message,
        details: error.stack, // Including stack trace for debugging
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});

// API route handler
router.get("/api/trending-movies", async (request, env, ctx) => {
  try {
    if (!env?.TRENDING_MOVIES) {
      throw new Error("KV namespace MOVIES is not configured");
    }

    const movies = await env.TRENDING_MOVIES.get("TRENDING_MOVIES");

    if (!movies) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "No trending movies data available",
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    return new Response(movies, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Error in API route:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Internal server error",
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});

export default {
  fetch: router.fetch,

  scheduled: async (event, env, ctx) => {
    try {
      if (!env?.TRENDING_MOVIES) {
        throw new Error("KV namespace MOVIES is not configured");
      }

      console.log("Scheduled task running");
      const trendingMovies = await getTrendingMovies();
      const updatedMovies = await updateDatabase(trendingMovies, env);
      return {
        success: true,
        message: `Updated ${updatedMovies.length} new movies`,
        data: updatedMovies,
      };
    } catch (error) {
      console.error("Error in scheduled task:", error);
      return {
        success: false,
        message: "Scheduled task failed",
        error: error.message,
      };
    }
  },
};
