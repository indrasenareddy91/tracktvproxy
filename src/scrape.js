import { load } from "cheerio";
import { AutoRouter } from "itty-router";

const router = AutoRouter();

async function getTrendingMovies() {
  try {
    const response = await fetch("https://flixpatrol.com/top10/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const streamingServices = [
      "netflix-1",
      "hbo-1",
      "amazon-prime-1",
      "apple-tv-1",
    ];
    const results = [];

    streamingServices.forEach((service) => {
      const serviceDiv = $(`#${service}`);
      if (serviceDiv.length) {
        serviceDiv
          .find("tbody tr")
          .slice(0, 2)
          .each((index, element) => {
            const titleElement = $(element).find("td:nth-child(2) a");
            const titleText = titleElement.find("div:last-child").text().trim();
            const titleUrl = titleElement.attr("href") || "";

            // Extract year from URL if available
            const yearMatch = titleUrl.match(/-(\d{4})(?:\/|$)/);
            const year = yearMatch ? yearMatch[1] : "";

            // Format title with year if available
            const formattedTitle = year ? `${titleText} (${year})` : titleText;

            const isOriginal =
              $(element).find('span[title*="original"]').length > 0;
            const points = parseInt(
              $(element).find("td:nth-child(3)").text().trim(),
              10
            );

            results.push({
              rank: index + 1,
              title: formattedTitle.replace(/\s+/g, " "),
              isOriginal,
              points,
              platform:
                service.split("-")[0] +
                (service.split("-")[1] && isNaN(service.split("-")[1])
                  ? " " + service.split("-")[1]
                  : ""),
              date: new Date().toISOString().split("T")[0],
            });
          });
      }
    });

    return results;
  } catch (error) {
    console.error("Error in getTrendingMovies:", error);
    throw error;
  }
}

// API route to get current trending movies
router.get("/api/trending", async (request, env, ctx) => {
  try {
    if (!env?.TRENDING_MOVIES) {
      throw new Error("KV namespace TRENDING_MOVIES is not configured");
    }

    const moviesData = await env.TRENDING_MOVIES.get("TRENDING_MOVIES");

    if (!moviesData) {
      // If no data exists, fetch it immediately
      const trendingMovies = await getTrendingMovies();
      await env.TRENDING_MOVIES.put(
        "TRENDING_MOVIES",
        JSON.stringify(trendingMovies)
      );
      return new Response(JSON.stringify(trendingMovies), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response(moviesData, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Failed to fetch trending movies",
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

// Root route handler for manual updates
router.get("/", async (request, env, ctx) => {
  try {
    if (!env?.TRENDING_MOVIES) {
      throw new Error("KV namespace TRENDING_MOVIES is not configured");
    }

    const trendingMovies = await getTrendingMovies();

    await env.TRENDING_MOVIES.put(
      "TRENDING_MOVIES",
      JSON.stringify(trendingMovies)
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully updated ${trendingMovies.length} movies`,
        data: trendingMovies,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Failed to update movies",
        error: error.message,
        timestamp: new Date().toISOString(),
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

// Export the worker with scheduled functionality
export default {
  fetch: router.fetch,

  // Scheduled task to run daily
  scheduled: async (event, env, ctx) => {
    try {
      if (!env?.TRENDING_MOVIES) {
        throw new Error("KV namespace TRENDING_MOVIES is not configured");
      }

      const trendingMovies = await getTrendingMovies();

      await env.TRENDING_MOVIES.put(
        "TRENDING_MOVIES",
        JSON.stringify(trendingMovies)
      );

      return {
        success: true,
        message: `Successfully updated ${trendingMovies.length} movies`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Error in scheduled task:", error);
      return {
        success: false,
        message: "Scheduled task failed",
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
